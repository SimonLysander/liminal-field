/**
 * EXIF_TEXT_FIELDS — 单张照片 EXIF 4 个可编辑字段的统一定义。
 *
 * 抽到独立文件让 LocationSelect 和 PhotoRowEditor 共用,避免:
 *   1. 两处手抄(改格式时漏改一处)
 *   2. react-refresh 规则:组件文件同时 export 常量会破坏 fast refresh
 *
 * 字段:光圈/快门/ISO/焦距。用户只输数字,prefix/suffix 拼单位。
 * - 存储:`f/2.8`、`1/250s`、`400`、`28mm`
 * - 输入:纯数字(2.8 / 1/250 / 400 / 28)
 * - pattern 校验的是纯数字部分
 */

export const EXIF_TEXT_FIELDS: {
  key: string;
  label: string;
  placeholder: string;
  prefix?: string;
  suffix?: string;
  pattern: RegExp;
  parse: (v: string) => string;
  format: (v: string) => string;
}[] = [
  {
    key: 'aperture', label: '光圈', placeholder: '2.8',
    prefix: 'f/',
    pattern: /^\d+(\.\d+)?$/,
    parse: (v) => v.replace(/^f\//, ''),
    format: (v) => (v ? `f/${v}` : ''),
  },
  {
    key: 'shutter', label: '快门', placeholder: '1/250',
    suffix: 's',
    pattern: /^(1\/\d+|\d+(\.\d+)?)$/,
    parse: (v) => v.replace(/s$/, ''),
    format: (v) => (v ? `${v}s` : ''),
  },
  {
    key: 'iso', label: 'ISO', placeholder: '400',
    pattern: /^\d+$/,
    parse: (v) => v,
    format: (v) => v,
  },
  {
    key: 'focalLength', label: '焦距', placeholder: '28',
    suffix: 'mm',
    pattern: /^\d+$/,
    parse: (v) => v.replace(/mm$/, ''),
    format: (v) => (v ? `${v}mm` : ''),
  },
];
