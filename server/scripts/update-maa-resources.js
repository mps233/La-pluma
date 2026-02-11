/**
 * 从 GitHub 下载 MaaResource 资源文件并更新到 MAA 目录
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// GitHub 仓库信息
const REPO_URL = 'https://github.com/MaaAssistantArknights/MaaResource.git';
const TEMP_DIR = path.join(__dirname, '../.temp-maa-resource');

/**
 * 获取 MAA 资源目录路径
 */
function getMaaResourceDir() {
  try {
    // 执行 maa dir data 获取数据目录
    const dataDir = execSync('maa dir data', { encoding: 'utf-8' }).trim();
    // 资源目录在数据目录的 resource 子目录
    const resourceDir = path.join(dataDir, 'resource');
    
    console.log(`MAA 资源目录: ${resourceDir}`);
    return resourceDir;
  } catch (error) {
    throw new Error(`无法获取 MAA 资源目录: ${error.message}`);
  }
}

/**
 * 复制目录（递归）
 */
function copyDir(src, dest) {
  // 确保目标目录存在
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 删除目录（递归）
 */
function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 更新资源文件
 */
async function updateResources() {
  console.log('开始更新 MAA 资源文件...\n');
  
  try {
    // 获取 MAA 资源目录
    const resourceDir = getMaaResourceDir();
    
    if (!fs.existsSync(resourceDir)) {
      throw new Error(`MAA 资源目录不存在: ${resourceDir}`);
    }
    
    // 清理临时目录
    console.log('清理临时目录...');
    removeDir(TEMP_DIR);
    
    // 克隆仓库（只克隆最新的提交，节省时间和空间）
    console.log('从 GitHub 下载资源文件...');
    console.log(`仓库: ${REPO_URL}`);
    
    try {
      execSync(`git clone --depth 1 --single-branch --branch main "${REPO_URL}" "${TEMP_DIR}"`, {
        stdio: 'inherit'
      });
    } catch (error) {
      throw new Error(`Git 克隆失败: ${error.message}`);
    }
    
    // 检查 resource 目录是否存在
    const sourceResourceDir = path.join(TEMP_DIR, 'resource');
    if (!fs.existsSync(sourceResourceDir)) {
      throw new Error(`下载的仓库中没有 resource 目录`);
    }
    
    // 复制资源文件
    console.log('\n复制资源文件到 MAA 目录...');
    copyDir(sourceResourceDir, resourceDir);
    
    // 清理临时目录
    console.log('\n清理临时文件...');
    removeDir(TEMP_DIR);
    
    console.log('\n✓ 资源文件更新成功！');
    
  } catch (error) {
    // 清理临时目录
    removeDir(TEMP_DIR);
    
    console.error('\n✗ 更新失败:', error.message);
    process.exit(1);
  }
}

// 执行更新
updateResources();
