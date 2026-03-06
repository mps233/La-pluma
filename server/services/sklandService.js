/**
 * 森空岛 API 服务
 * 提供森空岛账号认证和数据获取功能
 */

import fetch from 'node-fetch';
import crypto from 'crypto';
import { unlink } from 'fs/promises';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.js';
import { createLogger } from '../utils/logger.js';
import stageDataService from './stageDataService.js';

const logger = createLogger('SklandService');

class SklandService {
  constructor() {
    this.configPath = 'data/user-configs/skland-account.json';
    this.charactersPath = 'data/characters.json';
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
    this.tokenExpiry = 24 * 60 * 60 * 1000; // Token 24小时有效期
    this.tokenRefreshThreshold = 23 * 60 * 60 * 1000; // 23小时后刷新
    this.cache = {
      playerInfo: null,
      timestamp: 0
    };
    this.characters = null; // 干员数据缓存
  }

  /**
   * 加载干员数据
   */
  async loadCharacters() {
    if (this.characters) {
      return this.characters;
    }
    
    try {
      this.characters = await readJsonFile(this.charactersPath);
      logger.debug('[Skland] 干员数据加载成功，共', Object.keys(this.characters).length, '个干员');
      return this.characters;
    } catch (error) {
      logger.error('[Skland] 加载干员数据失败:', error.message);
      return {};
    }
  }

  /**
   * 根据 charId 获取干员名称
   */
  async getCharacterName(charId) {
    const characters = await this.loadCharacters();
    return characters[charId]?.name || charId;
  }

  /**
   * 生成签名
   */
  generateSignature(token, path, queryOrBody, timestamp) {
    const headerForSign = {
      'platform': '1',
      'timestamp': timestamp,
      'dId': '',
      'vName': '1.21.0'
    };
    
    const headerStr = JSON.stringify(headerForSign);
    const signStr = path + queryOrBody + timestamp + headerStr;
    
    // HMAC-SHA256
    const hmac = crypto.createHmac('sha256', token);
    hmac.update(signStr, 'utf-8');
    const hexS = hmac.digest('hex');
    
    // MD5
    const md5 = crypto.createHash('md5');
    md5.update(hexS, 'utf-8');
    return md5.digest('hex');
  }

  /**
   * 加密密码（简单的 AES 加密）
   */
  encryptPassword(password) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('skland-maa-secret-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0); // 使用固定 IV（生产环境应使用随机 IV）
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * 解密密码
   */
  decryptPassword(encryptedPassword) {
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync('skland-maa-secret-key', 'salt', 32);
      const iv = Buffer.alloc(16, 0);
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedPassword, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      logger.error('[Skland] 解密密码失败:', error.message);
      return null;
    }
  }

  /**
   * 生成请求头
   */
  generateHeaders(token, cred, path, queryOrBody = '') {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = this.generateSignature(token, path, queryOrBody, timestamp);
    
    return {
      'User-Agent': 'Skland/1.21.0 (com.hypergryph.skland; build:102100065; iOS 17.6.0; ) Alamofire/5.7.1',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      'platform': '1',
      'Accept-Language': 'zh-Hans-CN;q=1.0',
      'dId': '',
      'vName': '1.21.0',
      'language': 'zh-hans-CN',
      'cred': cred,
      'sign': sign,
      'timestamp': timestamp
    };
  }

  /**
   * 发送验证码
   */
  async sendCode(phone) {
    try {
      const response = await fetch(
        'https://as.hypergryph.com/general/v1/send_phone_code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            phone,
            type: 2  // 2 表示登录验证码
          })
        }
      );

      const data = await response.json();
      if (data.status === 0) {
        logger.info('[Skland] 验证码发送成功');
        return { success: true, message: '验证码已发送' };
      } else {
        logger.error('[Skland] 验证码发送失败:', data.msg);
        return { success: false, error: data.msg || '发送失败' };
      }
    } catch (error) {
      logger.error('[Skland] 发送验证码请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 使用验证码登录
   */
  async loginByCode(phone, code) {
    try {
      const response = await fetch(
        'https://as.hypergryph.com/user/auth/v2/token_by_phone_code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code })
        }
      );

      const data = await response.json();
      if (data.status === 0) {
        logger.info('[Skland] 验证码登录成功');
        return { success: true, token: data.data.token };
      } else {
        logger.error('[Skland] 验证码登录失败:', data.msg);
        return { success: false, error: data.msg || '登录失败' };
      }
    } catch (error) {
      logger.error('[Skland] 验证码登录请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 步骤1: 使用手机号密码登录
   */
  async loginByPassword(phone, password) {
    try {
      const response = await fetch(
        'https://as.hypergryph.com/user/auth/v1/token_by_phone_password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, password })
        }
      );

      const data = await response.json();
      if (data.status === 0) {
        logger.info('[Skland] 登录成功');
        return { success: true, token: data.data.token };
      } else {
        logger.error('[Skland] 登录失败:', data.msg);
        return { success: false, error: data.msg };
      }
    } catch (error) {
      logger.error('[Skland] 登录请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 步骤2: 获取 OAuth2 授权代码
   */
  async getOAuthCode(hypergryphToken) {
    try {
      const response = await fetch(
        'https://as.hypergryph.com/user/oauth2/v2/grant',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: hypergryphToken,
            appCode: '4ca99fa6b56cc2ba',
            type: 0
          })
        }
      );

      const data = await response.json();
      if (data.status === 0) {
        logger.info('[Skland] 获取授权代码成功');
        return { success: true, code: data.data.code };
      } else {
        logger.error('[Skland] 获取授权代码失败:', data.msg);
        return { success: false, error: data.msg };
      }
    } catch (error) {
      logger.error('[Skland] 获取授权代码请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 步骤3: 生成 Cred 和 Token
   */
  async generateCred(code) {
    try {
      const response = await fetch(
        'https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 1, code })
        }
      );

      const data = await response.json();
      if (data.code === 0) {
        logger.info('[Skland] 生成 Cred 成功');
        return {
          success: true,
          cred: data.data.cred,
          token: data.data.token
        };
      } else {
        logger.error('[Skland] 生成 Cred 失败:', data.message);
        return { success: false, error: data.message };
      }
    } catch (error) {
      logger.error('[Skland] 生成 Cred 请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 完整登录流程（支持密码和验证码）
   */
  async login(phone, codeOrPassword, savePassword = false) {
    try {
      // 判断是验证码还是密码（验证码通常是6位数字）
      const isCode = /^\d{6}$/.test(codeOrPassword);
      
      // 步骤1: 登录
      let loginResult;
      if (isCode) {
        loginResult = await this.loginByCode(phone, codeOrPassword);
      } else {
        loginResult = await this.loginByPassword(phone, codeOrPassword);
      }
      
      if (!loginResult.success) {
        return loginResult;
      }

      // 步骤2: 获取授权代码
      const oauthResult = await this.getOAuthCode(loginResult.token);
      if (!oauthResult.success) {
        return oauthResult;
      }

      // 步骤3: 生成 Cred
      const credResult = await this.generateCred(oauthResult.code);
      if (!credResult.success) {
        return credResult;
      }

      // 保存配置
      const config = {
        cred: credResult.cred,
        token: credResult.token,
        phone: phone.substring(0, 3) + '****' + phone.substring(7), // 脱敏
        loginTime: Date.now()
      };

      // 如果是密码登录且用户选择保存密码，则保存加密后的密码
      if (!isCode && savePassword) {
        config.savedPhone = phone; // 保存完整手机号用于自动重登
        config.savedPassword = this.encryptPassword(codeOrPassword);
        config.autoRelogin = true;
        logger.info('[Skland] 已保存登录凭据，启用自动重登');
      }

      await writeJsonFile(this.configPath, config);
      logger.info('[Skland] 账号配置已保存');

      return { success: true, message: '登录成功' };
    } catch (error) {
      logger.error('[Skland] 登录流程失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取保存的配置
   */
  async getConfig() {
    try {
      const config = await readJsonFile(this.configPath);
      return config;
    } catch (error) {
      return null;
    }
  }

  /**
   * 检查 token 是否需要刷新
   */
  needsRefresh(config) {
    if (!config || !config.loginTime) {
      return false;
    }
    
    const elapsed = Date.now() - config.loginTime;
    const needRefresh = elapsed > this.tokenRefreshThreshold;
    
    // 调试日志
    if (needRefresh) {
      logger.debug(`[Skland] Token 需要刷新: 已过 ${Math.floor(elapsed / 1000 / 60 / 60)} 小时`);
    }
    
    return needRefresh;
  }

  /**
   * 刷新 token
   */
  async refreshToken() {
    try {
      const config = await this.getConfig();
      if (!config || !config.cred || !config.token) {
        logger.warn('[Skland] 无法刷新 token：配置不完整');
        return { success: false, error: '配置不完整' };
      }

      logger.info('[Skland] 开始刷新 token...');

      // Token 仍然有效，只需更新登录时间即可
      config.loginTime = Date.now();
      await writeJsonFile(this.configPath, config);
      logger.info('[Skland] Token 刷新成功（更新时间戳）');

      // 清除缓存，强制下次重新获取数据
      this.cache.playerInfo = null;
      this.cache.timestamp = 0;

      return { success: true, message: 'Token 已刷新' };
    } catch (error) {
      logger.error('[Skland] 刷新 token 失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 自动重新登录
   */
  async autoRelogin() {
    try {
      const config = await this.getConfig();
      if (!config || !config.savedPhone || !config.savedPassword) {
        logger.warn('[Skland] 无法自动重登：缺少保存的登录凭据');
        return { success: false, error: '缺少登录凭据', needRelogin: true };
      }

      logger.info('[Skland] 开始自动重登...');

      // 解密密码
      const password = this.decryptPassword(config.savedPassword);
      if (!password) {
        logger.error('[Skland] 解密密码失败');
        return { success: false, error: '解密失败', needRelogin: true };
      }

      // 使用保存的账号密码重新登录
      const loginResult = await this.login(config.savedPhone, password, true);
      
      if (loginResult.success) {
        logger.info('[Skland] 自动重登成功');
        return { success: true, message: '自动重登成功', autoRelogin: true };
      } else {
        logger.error('[Skland] 自动重登失败:', loginResult.error);
        return { success: false, error: loginResult.error, needRelogin: true };
      }
    } catch (error) {
      logger.error('[Skland] 自动重登失败:', error.message);
      return { success: false, error: error.message, needRelogin: true };
    }
  }

  /**
   * 自动刷新 token（如果需要）
   */
  async autoRefreshToken() {
    const config = await this.getConfig();
    if (!config) {
      return { success: false, error: '未登录' };
    }

    // 检查是否需要刷新
    if (!this.needsRefresh(config)) {
      return { success: true, message: 'Token 仍然有效' };
    }

    // 避免重复刷新：如果上次刷新时间距离现在不到 1 分钟，跳过
    const lastRefreshElapsed = Date.now() - config.loginTime;
    if (lastRefreshElapsed < 60 * 1000) {
      logger.debug('[Skland] Token 刚刚刷新过，跳过本次刷新');
      return { success: true, message: 'Token 刚刚刷新过' };
    }

    logger.info('[Skland] Token 即将过期，自动刷新...');
    return await this.refreshToken();
  }

  /**
   * 检查是否已登录
   */
  async isLoggedIn() {
    const config = await this.getConfig();
    return config && config.cred && config.token;
  }

  /**
   * 获取玩家绑定角色
   */
  async getPlayerBinding() {
    const config = await this.getConfig();
    if (!config) {
      return { success: false, error: '未登录' };
    }

    // 自动刷新 token（如果需要）
    const refreshResult = await this.autoRefreshToken();
    if (!refreshResult.success && refreshResult.error !== 'Token 仍然有效') {
      logger.warn('[Skland] Token 刷新失败，尝试自动重新登录');
      
      // 如果配置了自动重新登录且保存了密码，尝试重新登录
      if (config.autoRelogin && config.savedPassword) {
        const password = this.decryptPassword(config.savedPassword);
        if (password) {
          logger.info('[Skland] 尝试使用保存的密码自动重新登录');
          const loginResult = await this.loginByPassword(config.savedPhone, password);
          if (loginResult.success) {
            logger.info('[Skland] 自动重新登录成功');
            // 重新获取配置
            const newConfig = await this.getConfig();
            if (!newConfig) {
              return { success: false, error: '重新登录后配置获取失败' };
            }
          } else {
            logger.error('[Skland] 自动重新登录失败:', loginResult.error);
            return { success: false, error: '登录已过期，自动重新登录失败', needRelogin: true };
          }
        }
      } else {
        return { success: false, error: '登录已过期，请重新登录', needRelogin: true };
      }
    }

    try {
      const path = '/api/v1/game/player/binding';
      const headers = this.generateHeaders(config.token, config.cred, path, '');
      
      logger.debug('[Skland] 请求绑定角色, URL:', `https://zonai.skland.com${path}`);
      logger.debug('[Skland] 请求头:', JSON.stringify(headers, null, 2));
      
      const response = await fetch(`https://zonai.skland.com${path}`, {
        method: 'GET',
        headers: headers
      });

      if (!response.ok) {
        logger.error('[Skland] HTTP 请求失败, 状态码:', response.status);
        
        // 401 表示未授权，token 已失效
        if (response.status === 401) {
          logger.warn('[Skland] 收到 401 错误，Token 已失效');
          
          // 如果配置了自动重新登录且保存了密码，尝试重新登录
          if (config.autoRelogin && config.savedPassword) {
            const password = this.decryptPassword(config.savedPassword);
            if (password) {
              logger.info('[Skland] 尝试使用保存的密码自动重新登录');
              const loginResult = await this.login(config.savedPhone, password, true);
              if (loginResult.success) {
                logger.info('[Skland] 自动重新登录成功，重试获取绑定角色');
                // 重新获取配置后再次尝试（只重试一次）
                const newConfig = await this.getConfig();
                if (newConfig && newConfig.token && newConfig.cred) {
                  logger.debug('[Skland] 使用新 token 重试, cred:', newConfig.cred);
                  // 直接重新发起请求，不递归调用
                  // 重要：必须重新生成 headers，因为 timestamp 和 sign 都需要更新
                  try {
                    const retryHeaders = this.generateHeaders(newConfig.token, newConfig.cred, path, '');
                    logger.debug('[Skland] 重试请求头（新生成）:', JSON.stringify(retryHeaders, null, 2));
                    
                    const retryResponse = await fetch(`https://zonai.skland.com${path}`, {
                      method: 'GET',
                      headers: retryHeaders
                    });
                    
                    logger.info('[Skland] 重试请求状态码:', retryResponse.status);
                    
                    if (retryResponse.ok) {
                      const retryData = await retryResponse.json();
                      logger.debug('[Skland] 重试响应数据:', JSON.stringify(retryData, null, 2));
                      
                      if (retryData.code === 0) {
                        const arknights = retryData.data.list.find(game => game.appCode === 'arknights');
                        if (arknights && arknights.bindingList.length > 0) {
                          const uid = arknights.bindingList[0].uid;
                          logger.info('[Skland] 重试成功，获取绑定角色成功, UID:', uid);
                          return { success: true, uid, data: retryData.data };
                        } else {
                          logger.warn('[Skland] 重试成功但未找到明日方舟角色');
                        }
                      } else {
                        logger.error('[Skland] 重试失败, code:', retryData.code, 'message:', retryData.message);
                      }
                    } else {
                      logger.error('[Skland] 重试请求失败, 状态码:', retryResponse.status);
                      const retryText = await retryResponse.text();
                      logger.error('[Skland] 重试响应内容:', retryText);
                    }
                  } catch (retryError) {
                    logger.error('[Skland] 重试请求异常:', retryError.message);
                    logger.error('[Skland] 重试错误堆栈:', retryError.stack);
                  }
                } else {
                  logger.error('[Skland] 重新登录后无法获取新配置');
                }
              } else {
                logger.error('[Skland] 自动重新登录失败:', loginResult.error);
              }
            }
          }
          
          return { success: false, error: '登录已过期，请重新登录', needRelogin: true };
        }
        
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const data = await response.json();
      logger.debug('[Skland] 响应数据:', JSON.stringify(data, null, 2));
      
      // 检查是否是 token 失效错误
      if (data.code === 10001 || data.message === '未登录') {
        logger.warn('[Skland] Token 已失效');
        
        // 如果配置了自动重新登录且保存了密码，尝试重新登录
        if (config.autoRelogin && config.savedPassword) {
          const password = this.decryptPassword(config.savedPassword);
          if (password) {
            logger.info('[Skland] Token 失效，尝试使用保存的密码自动重新登录');
            const loginResult = await this.loginByPassword(config.savedPhone, password);
            if (loginResult.success) {
              logger.info('[Skland] 自动重新登录成功，重试获取绑定角色');
              // 递归调用自己（只重试一次）
              return await this.getPlayerBinding();
            } else {
              logger.error('[Skland] 自动重新登录失败:', loginResult.error);
            }
          }
        }
        
        return { success: false, error: '登录已过期，请重新登录', needRelogin: true };
      }
      
      if (data.code === 0) {
        // 查找明日方舟角色
        const arknights = data.data.list.find(game => game.appCode === 'arknights');
        if (arknights && arknights.bindingList.length > 0) {
          const uid = arknights.bindingList[0].uid;
          logger.info('[Skland] 获取绑定角色成功, UID:', uid);
          return { success: true, uid, data: data.data };
        } else {
          return { success: false, error: '未找到明日方舟角色' };
        }
      } else {
        logger.error('[Skland] 获取绑定角色失败, code:', data.code, 'message:', data.message);
        return { success: false, error: data.message };
      }
    } catch (error) {
      logger.error('[Skland] 获取绑定角色请求异常:', error);
      logger.error('[Skland] 错误堆栈:', error.stack);
      return { success: false, error: `请求异常: ${error.message}` };
    }
  }

  /**
   * 获取玩家游戏数据
   */
  async getPlayerInfo(useCache = true) {
    // 检查缓存
    if (useCache && this.cache.playerInfo && (Date.now() - this.cache.timestamp < this.cacheExpiry)) {
      logger.info('[Skland] 使用缓存数据');
      return { success: true, data: this.cache.playerInfo, cached: true };
    }

    const config = await this.getConfig();
    if (!config) {
      return { success: false, error: '未登录' };
    }

    // 自动刷新 token（如果需要）
    await this.autoRefreshToken();

    try {
      // 先获取 UID
      const bindingResult = await this.getPlayerBinding();
      if (!bindingResult.success) {
        return bindingResult;
      }

      const uid = bindingResult.uid;
      const path = `/api/v1/game/player/info`;
      const query = `uid=${uid}`;
      const headers = this.generateHeaders(config.token, config.cred, path, query);
      
      const response = await fetch(`https://zonai.skland.com${path}?${query}`, {
        method: 'GET',
        headers: headers
      });

      const result = await response.json();
      
      // 检查是否是 token 失效错误
      if (result.code === 10001 || result.message === '未登录') {
        logger.warn('[Skland] Token 已失效');
        // 清除缓存
        this.cache.playerInfo = null;
        this.cache.timestamp = 0;
        return { success: false, error: '登录已过期，请重新登录', needRelogin: true };
      }
      
      if (result.code === 0) {
        logger.info('[Skland] 获取玩家数据成功');
        
        // 更新缓存
        this.cache.playerInfo = result.data;
        this.cache.timestamp = Date.now();
        
        return { success: true, data: result.data };
      } else {
        logger.error('[Skland] 获取玩家数据失败:', result.message);
        return { success: false, error: result.message };
      }
    } catch (error) {
      logger.error('[Skland] 获取玩家数据请求失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取玩家游戏数据（别名方法，与路由保持一致）
   */
  async getPlayerData(useCache = true) {
    return this.getPlayerInfo(useCache);
  }

  /**
   * 登出（删除配置）
   */
  async logout() {
    try {
      await unlink(this.configPath);
      this.cache.playerInfo = null;
      this.cache.timestamp = 0;
      logger.info('[Skland] 已登出');
      return { success: true };
    } catch (error) {
      // 文件不存在也算成功
      if (error.code === 'ENOENT') {
        logger.info('[Skland] 配置文件不存在，已清理缓存');
        return { success: true };
      }
      logger.error('[Skland] 登出失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取 Dashboard 摘要数据
   */
  async getDashboardSummary() {
    const result = await this.getPlayerInfo();
    if (!result.success) {
      return result;
    }

    const data = result.data;
    
    // 调试：打印原始数据结构（包括 assistChars）
    logger.debug('[Skland] 原始数据中的助战干员字段:');
    logger.debug('[Skland] - data.assistCharList:', JSON.stringify(data.assistCharList || null));
    logger.debug('[Skland] - data.assistChars:', JSON.stringify(data.assistChars || null));
    logger.debug('[Skland] - data.social:', JSON.stringify(data.social || null));
    logger.debug('[Skland] - data.social?.assistCharList:', JSON.stringify(data.social?.assistCharList || null));
    
    // 如果 assistChars 存在，打印详细信息
    if (data.assistChars && data.assistChars.length > 0) {
      logger.info('[Skland] 找到助战干员数据，数量:', data.assistChars.length);
      data.assistChars.forEach((char, index) => {
        logger.debug(`[Skland] 助战干员 ${index + 1}:`, JSON.stringify(char));
      });
    } else {
      logger.warn('[Skland] 未找到助战干员数据，将使用前3个精二干员');
    }
    
    // 提取关键数据
    const summary = {
      // 玩家信息
      uid: data.status.uid,
      nickname: data.status.name,
      level: data.status.level,
      registerTs: data.status.registerTs,
      mainStageProgress: data.status.mainStageProgress,
      secretary: data.status.secretary?.charId || '未设置',
      secretaryName: data.status.secretary?.charName || '未设置',
      avatarId: data.status.avatar?.id || '',
      avatarUrl: data.status.avatar?.url || '', // 直接使用 API 返回的完整 URL
      
      // 关卡信息（增强）
      stageInfo: stageDataService.getStageByCode(data.status.mainStageProgress) || null,
      
      // 实时数据
      ap: {
        current: (() => {
          // 如果理智已满或没有恢复时间，直接返回 max
          if (!data.status.ap.completeRecoveryTime || data.status.ap.completeRecoveryTime <= Date.now() / 1000) {
            return data.status.ap.max;
          }
          // 计算当前理智：max - 剩余恢复时间对应的理智数
          // 理智恢复速度：6分钟（360秒）恢复1点
          const remainingSeconds = data.status.ap.completeRecoveryTime - Date.now() / 1000;
          const remainingAp = Math.ceil(remainingSeconds / 360); // 向上取整，表示还需要恢复的理智数
          const currentAp = data.status.ap.max - remainingAp;
          // 确保不超过最大值
          return Math.min(Math.max(currentAp, 0), data.status.ap.max);
        })(),
        max: data.status.ap.max,
        completeRecoveryTime: data.status.ap.completeRecoveryTime
      },
      
      // 干员统计
      chars: {
        total: data.chars.length,
        elite2: data.chars.filter(c => c.evolvePhase === 2).length,
        maxLevel: data.chars.filter(c => {
          if (c.evolvePhase === 0) return c.level >= 50;
          if (c.evolvePhase === 1) return c.level >= 80;
          if (c.evolvePhase === 2) return c.level >= 90;
          return false;
        }).length,
        skill7Plus: data.chars.filter(c => c.mainSkillLvl >= 7).length
      },
      
      // 基建
      building: {
        furniture: data.building.furniture.total || data.building.furniture,
        labor: data.building.labor,
        // 添加更多基建数据
        manufactures: data.building.manufactures || [],
        trading: data.building.trading || [],
        dormitories: data.building.dormitories || [],
        meeting: data.building.meeting || {},
        hire: data.building.hire || {},
        training: data.building.training || {}
      },
      
      // 公招
      recruit: data.recruit ? data.recruit.map(slot => ({
        state: slot.state,
        finishTs: slot.finishTs,
        tags: slot.tags
      })) : [],
      
      // 任务
      routine: data.routine ? {
        daily: data.routine.daily,
        weekly: data.routine.weekly
      } : null,
      
      // 剿灭
      campaign: data.campaign ? {
        reward: data.campaign.reward
      } : null,
      
      // 助战干员（优先使用 assistChars，如果没有则从 chars 中提取前3个精二干员）
      assistChars: await Promise.all(
        ((data.assistChars || []).length > 0
          ? (data.assistChars || [])
          : data.chars
              .filter(c => c.evolvePhase === 2)
              .slice(0, 3)
        ).map(async (c) => ({
          charId: c.charId,
          skinId: c.skinId || c.charId, // 添加皮肤ID
          name: await this.getCharacterName(c.charId), // 从数据库获取干员名称
          level: c.level,
          evolvePhase: c.evolvePhase,
          mainSkillLvl: c.mainSkillLvl || c.skillLevel || 0,
          skills: c.skills || []
        }))
      ),
      
      // 社交相关
      social: data.social || {},
      
      // 训练室
      training: data.building?.training || null,
      
      // 线索
      clue: data.building?.meeting?.clue || null
    };

    return { success: true, data: summary };
  }
}

export default new SklandService();
