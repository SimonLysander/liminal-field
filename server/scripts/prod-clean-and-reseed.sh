#!/usr/bin/env bash
# 一次性脚本: 清生产 DB 的 digest 残留数据(InfoSource 老 fetcherKind 没对齐 / 卡死 task / 老报告导航节点)
# + 重启 server 让 onModuleInit 重 seed InfoSources(带正确 fetcherKind+config)
#
# 用法(在生产服务器 root 跑):
#   cd /path/to/liminal-field
#   bash server/scripts/prod-clean-and-reseed.sh
#
# 前置:
#   - 确认你在生产服务器
#   - 确认事项配置(SmartTopicConfig)的 sourceIds 已经备份/可重设(脚本会失效化它们)
#
# 它不会动:
#   - SmartTopicConfig(事项配置本身) — 但 sourceIds 会指向已删源,你需要在 admin
#     重新勾选订阅源(或者改 mongo 直接关联)
#   - ContentItem 笔记/文集/画廊
#   - NavigationNode notes/anthology/gallery
#   - User/Settings/AiProviders

set -euo pipefail

echo "=== 生产 DB 清理 + 重 seed ==="
echo ""
echo "目标 collection 清理:"
echo "  - info_sources (老 fetcherKind 没对齐,需要重 seed)"
echo "  - digest_tasks (卡死 + 历史失败)"
echo "  - digest_reports (老叙事散文体)"
echo "  - processed_feed_items (历史去重池,清空让新跑没包袱)"
echo "  - navigation_nodes scope=digest (老报告导航节点 + 事项 root,**事项 root 会重建**)"
echo ""
read -p "确认执行? [y/N] " confirm
[[ "$confirm" != "y" ]] && { echo "取消"; exit 0; }

# Mongo container 名: 按 docker-compose.yml 默认 mongo service
MONGO_CONTAINER="${MONGO_CONTAINER:-mongo}"
MONGO_USER="${MONGO_USER:-}"
MONGO_PASSWORD="${MONGO_PASSWORD:-}"
MONGO_DATABASE="${MONGO_DATABASE:-liminal-field}"

# 优先用 docker exec mongosh(7+),不行 fallback mongo 命令
MONGO_CMD="docker exec ${MONGO_CONTAINER} mongosh --quiet"
if [[ -n "$MONGO_USER" ]] && [[ -n "$MONGO_PASSWORD" ]]; then
  MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/${MONGO_DATABASE}?authSource=admin"
else
  MONGO_URI="mongodb://localhost:27017/${MONGO_DATABASE}"
fi

echo ""
echo "=== 清理前盘点 ==="
$MONGO_CMD "$MONGO_URI" --eval '
print("info_sources:", db.info_sources.countDocuments());
print("digest_tasks:", db.digest_tasks.countDocuments());
print("digest_reports:", db.digest_reports.countDocuments());
print("processed_feed_items:", db.processed_feed_items.countDocuments());
print("navigation_nodes scope=digest:", db.navigation_nodes.countDocuments({scope:"digest"}));
print("smart_topic_configs (保留):", db.smart_topic_configs.countDocuments());
'

echo ""
echo "=== 备份事项的 NavigationNode 内容(脚本会重建) ==="
TOPIC_NODES=$($MONGO_CMD "$MONGO_URI" --eval '
db.navigation_nodes.find({scope:"digest", nodeType:"content"}).forEach(n => {
  print(JSON.stringify({_id: n._id.toString(), name: n.name, contentItemId: n.contentItemId, order: n.order}));
});
')
echo "$TOPIC_NODES"

echo ""
echo "=== 清理 ==="
$MONGO_CMD "$MONGO_URI" --eval '
const a = db.info_sources.deleteMany({});
print("info_sources 删:", a.deletedCount);
const b = db.digest_tasks.deleteMany({});
print("digest_tasks 删:", b.deletedCount);
const c = db.digest_reports.deleteMany({});
print("digest_reports 删:", c.deletedCount);
const d = db.processed_feed_items.deleteMany({});
print("processed_feed_items 删:", d.deletedCount);
const e = db.navigation_nodes.deleteMany({scope:"digest"});
print("navigation_nodes scope=digest 删:", e.deletedCount);
'

echo ""
echo "=== 重建事项 root NavigationNode(用 SmartTopicConfig 找到的 contentItemId) ==="
$MONGO_CMD "$MONGO_URI" --eval '
const stcs = db.smart_topic_configs.find({}).toArray();
print("事项数量:", stcs.length);
for (const stc of stcs) {
  const item = db.content_items.findOne({_id: stc.contentItemId});
  if (!item) {
    print("  ✗ 事项", stc._id, "的 ContentItem", stc.contentItemId, "不存在,跳过");
    continue;
  }
  const r = db.navigation_nodes.insertOne({
    _id: new ObjectId(),
    name: item?.latestVersion?.title || "未命名事项",
    scope: "digest",
    nodeType: "content",
    contentItemId: stc.contentItemId,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  });
  print("  ✓ 事项 navNode 已重建:", item.latestVersion?.title, "→", r.insertedId.toString());
}
'

echo ""
echo "=== 重启 server 容器让 onModuleInit 重 seed InfoSources ==="
docker compose restart server
sleep 8

echo ""
echo "=== 验证 ==="
$MONGO_CMD "$MONGO_URI" --eval '
print("info_sources 重 seed 后:", db.info_sources.countDocuments());
print("按 fetcherKind 分布:");
const grp = {};
db.info_sources.find({}, {fetcherKind:1}).forEach(s => { grp[s.fetcherKind]=(grp[s.fetcherKind]||0)+1; });
Object.keys(grp).sort().forEach(k => print("  ", k, ":", grp[k]));
'

echo ""
echo "=== 完成 ==="
echo ""
echo "⚠ 还需手动:"
echo "  - 进 admin 编辑事项,**重新勾选订阅信息源**(老 sourceIds 失效了)"
echo "  - 或者按 source.name 匹配新 _id 用 mongo update stc.sourceIds (参考本地清理时的脚本)"
