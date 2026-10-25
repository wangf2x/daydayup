const config = require('./config');
const cloudbaseModule = require('@cloudbase/js-sdk');
const adapterModule = require('@cloudbase/adapter-wx_mp');
const cloudbase = cloudbaseModule.default || cloudbaseModule;
const wxAdapter = adapterModule.default || adapterModule;

cloudbase.useAdapters(wxAdapter);

const cloudApp = cloudbase.init({
  env: config.cloudEnvId,
});

if (wx.cloud) {
  try {
    wx.cloud.init({ env: config.cloudEnvId, traceUser: false });
  } catch (error) {
    console.warn('[app] wx.cloud.init failed', error);
  }
}

App({
  globalData: {
    cloudbase: cloudApp,
    authUserId: '',
  },

  async ensureWechatSession() {
    const auth = this.globalData.cloudbase.auth;
    const { data, error } = await auth.signInWithOpenId({ useWxCloud: true });
    if (error) {
      throw error;
    }

    const user = data && data.user;
    if (!user || !user.id) {
      throw new Error('微信登录未返回 CloudBase 用户 ID，请检查小程序认证配置。');
    }
    if (user.is_anonymous) {
      throw new Error('登录结果仍是匿名身份，请检查 CloudBase 小程序认证配置。');
    }

    this.globalData.authUserId = user.id;
    return user;
  },
});
