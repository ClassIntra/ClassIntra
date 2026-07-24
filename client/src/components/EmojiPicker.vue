<template>
  <div class="emoji-picker" v-if="visible">
    <div class="emoji-tabs">
      <button
        v-for="cat in categories"
        :key="cat.key"
        class="emoji-tab"
        :class="{ active: activeCategory === cat.key }"
        @click="activeCategory = cat.key"
      ><i :class="cat.icon"></i></button>
    </div>
    <div class="emoji-grid">
      <button
        v-for="emoji in currentEmojis"
        :key="emoji"
        class="emoji-btn"
        @click="selectEmoji(emoji)"
      >{{ emoji }}</button>
    </div>
  </div>
</template>

<script>
var emojiData = {
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐'],
  gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄'],
  hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '🫶', '😍', '🥰', '😘', '💋', '💏', '💑'],
  objects: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🔥', '⭐', '🌟', '✨', '💫', '🌈', '☀️', '🌙', '⛅', '❄️', '💧', '🎵', '🎶', '🎸', '🎹', '🎺', '🎻', '🥁', '📱', '💻', '⌨️', '🖥️', '📷', '📹', '🎥', '📚', '📖', '✏️', '📝', '📌', '📎', '🔑', '🔒', '💡', '🔋', '🔌', '💰', '💵', '💳', '💎', '🔔']
};

export default {
  name: 'EmojiPicker',
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  data: function() {
    return {
      activeCategory: 'smileys',
      categories: [
        { key: 'smileys', icon: 'fa-solid fa-face-smile' },
        { key: 'gestures', icon: 'fa-solid fa-hand' },
        { key: 'hearts', icon: 'fa-solid fa-heart' },
        { key: 'objects', icon: 'fa-solid fa-wand-magic-sparkles' }
      ]
    };
  },
  computed: {
    currentEmojis: function() {
      return emojiData[this.activeCategory] || [];
    }
  },
  methods: {
    selectEmoji: function(emoji) {
      this.$emit('select', emoji);
    }
  }
};
</script>

<style scoped>
.emoji-picker {
  position: absolute;
  bottom: 100%;
  right: 0;
  width: 360px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  padding: 12px;
  margin-bottom: 8px;
  z-index: 100;
}

.emoji-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  border-bottom: 0.5px solid var(--separator-color);
  padding-bottom: 8px;
}

.emoji-tab {
  font-size: 20px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: transparent;
  transition: background 0.2s;
}

.emoji-tab:hover {
  background: var(--bg-color);
}

.emoji-tab.active {
  background: rgba(0, 122, 255, 0.1);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}

.emoji-btn {
  font-size: 22px;
  padding: 6px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}

.emoji-btn:hover {
  background: var(--bg-color);
  transform: scale(1.2);
}
</style>
