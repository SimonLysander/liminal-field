/**
 * 批量导入的文件暂存——模块级变量，跨页面存活。
 *
 * FileList 是引用类型，input.value = '' 后会被清空。
 * 存入时立即 Array.from() 复制为独立数组，脱离 input 引用。
 */
let pendingFiles: File[] | null = null;

export function setPendingImportFiles(files: FileList) {
  pendingFiles = Array.from(files);
}

export function getPendingImportFiles(): File[] | null {
  return pendingFiles;
}

export function clearPendingImportFiles() {
  pendingFiles = null;
}
