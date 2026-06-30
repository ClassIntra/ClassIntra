import Vue from 'vue';
import Vuex from 'vuex';
import auth from './modules/auth';
import chat from './modules/chat';
import settings from './modules/settings';
import toast from './modules/toast';
import community from './modules/community';
import island from './modules/island';
import music from './modules/music';
import network from './modules/network';
import desktop from './modules/desktop';

Vue.use(Vuex);

export default new Vuex.Store({
  modules: {
    auth: auth,
    chat: chat,
    settings: settings,
    toast: toast,
    community: community,
    island: island,
    music: music,
    network: network,
    desktop: desktop
  }
});
