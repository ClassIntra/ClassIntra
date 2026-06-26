<template>
  <div
    class="user-avatar"
    :style="avatarStyle"
    @click="$emit('click', $event)"
  >
    {{ displayText }}
  </div>
</template>

<script>
import helpers from '@/utils/helpers';

export default {
  name: 'UserAvatar',
  props: {
    userId: { type: [String, Number], default: '' },
    name: { type: String, default: '' },
    isAnonymous: { type: Boolean, default: false },
    size: { type: Number, default: 40 }
  },
  computed: {
    avatarStyle: function() {
      var color = this.isAnonymous ? '#9E9E9E' : helpers.getAvatarColor(this.userId);
      return {
        width: this.size + 'px',
        height: this.size + 'px',
        fontSize: Math.max(12, this.size * 0.4) + 'px',
        background: color
      };
    },
    displayText: function() {
      if (this.isAnonymous) return '?';
      return helpers.getAvatarText(this.name);
    }
  }
};
</script>

<style scoped>
.user-avatar {
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
  cursor: pointer;
  transition: opacity 0.15s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Symbol', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
}
.user-avatar:hover {
  opacity: 0.85;
}
</style>
