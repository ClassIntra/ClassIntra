<template>
  <div class="weather-animation" :class="{ 'anim-fade': fading }" ref="animRoot">
    <canvas ref="canvas" class="anim-canvas" v-show="showParticles"></canvas>
    <div class="milky-way" v-if="isNight && (category === 'sunny' || category === 'cloudy')"></div>
    <div class="stars-layer" v-if="isNight && (category === 'sunny' || category === 'cloudy')" ref="starsLayer">
      <div v-for="s in stars" :key="s.id" class="star" :class="s.colorClass" :style="starStyle(s)" :data-star-id="s.id"></div>
      <div v-for="ss in shootingStars" :key="ss.id" class="shooting-star" :style="shootingStarStyle(ss)" :data-shooting-id="ss.id"></div>
    </div>
    <div class="moon" v-if="isNight && (category === 'sunny' || category === 'cloudy')" ref="moonEl">
      <div class="moon-glow-outer"></div>
      <div class="moon-glow"></div>
      <div class="moon-body">
        <div class="moon-crater crater-1"></div>
        <div class="moon-crater crater-2"></div>
        <div class="moon-crater crater-3"></div>
        <div class="moon-crater crater-4"></div>
      </div>
    </div>
    <div class="cloud-layer" v-show="showClouds" ref="cloudLayer">
      <div v-for="c in clouds" :key="c.id" class="cloud" :class="{ dark: c.dark, 'cloud-bg': c.isBg }" :style="cloudStyle(c)" :data-cloud-id="c.id"></div>
    </div>
    <div class="sunny-glow" v-if="category === 'sunny' && !isNight" ref="sunnyGlow"></div>
    <div class="sunny-glow-inner" v-if="category === 'sunny' && !isNight"></div>
    <div class="sunny-rays" v-if="category === 'sunny' && !isNight" ref="sunnyRays"></div>
    <div class="lens-flare" v-if="category === 'sunny' && !isNight" ref="lensFlare">
      <div class="flare-ring flare-ring-1"></div>
      <div class="flare-ring flare-ring-2"></div>
      <div class="flare-ring flare-ring-3"></div>
      <div class="flare-dot flare-dot-1"></div>
      <div class="flare-dot flare-dot-2"></div>
      <div class="flare-dot flare-dot-3"></div>
    </div>
    <div class="heat-shimmer" v-if="category === 'sunny' && !isNight" ref="heatShimmer"></div>
    <div class="lightning-flash" :class="{ active: flashActive }"></div>
    <svg v-if="boltActive" class="lightning-svg" ref="lightningSvg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <filter id="bolt-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="blur2" />
          <feMerge>
            <feMergeNode in="blur1" />
            <feMergeNode in="blur2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#bolt-glow)">
        <path v-for="(p, i) in boltPaths" :key="i" :d="p.d" :stroke-opacity="p.opacity" :stroke-width="p.width" stroke="#dce4ff" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
    <div class="fog-layer" v-if="category === 'fog'" ref="fogLayer">
      <div class="fog fog-1"></div>
      <div class="fog fog-2"></div>
      <div class="fog fog-3"></div>
      <div class="fog fog-4"></div>
      <div class="fog fog-5"></div>
      <div class="fog fog-6"></div>
      <div class="fog fog-7"></div>
      <div class="fog-particles" ref="fogParticles">
        <div v-for="fp in fogParticleList" :key="fp.id" class="fog-particle" :style="fogParticleStyle(fp)" :data-fp-id="fp.id"></div>
      </div>
    </div>
  </div>
</template>

<script>
import ParticleEngine from '@/utils/weather-particles';
import LightningCtrl from '@/utils/weather-lightning';

var CLOUD_CONFIGS = {
  cloudy: { count: 4, bgCount: 2, sizeMin: 80, sizeMax: 160, yMin: 5, yMax: 30, opacityMin: 0.06, opacityMax: 0.15, speedMin: 40, speedMax: 70, dark: false },
  overcast: { count: 8, bgCount: 3, sizeMin: 120, sizeMax: 280, yMin: 0, yMax: 40, opacityMin: 0.08, opacityMax: 0.2, speedMin: 60, speedMax: 100, dark: false },
  thunder: { count: 6, bgCount: 3, sizeMin: 150, sizeMax: 300, yMin: 0, yMax: 35, opacityMin: 0.12, opacityMax: 0.28, speedMin: 35, speedMax: 65, dark: true },
  rain: { count: 5, bgCount: 2, sizeMin: 100, sizeMax: 220, yMin: 0, yMax: 30, opacityMin: 0.06, opacityMax: 0.16, speedMin: 45, speedMax: 75, dark: false },
  snow: { count: 4, bgCount: 2, sizeMin: 80, sizeMax: 180, yMin: 5, yMax: 35, opacityMin: 0.06, opacityMax: 0.14, speedMin: 50, speedMax: 80, dark: false }
};

var FOG_CONFIGS = [
  { duration: 35000, from: 'translateX(-25%) translateY(0px)', to: 'translateX(0%) translateY(-8px)' },
  { duration: 45000, from: 'translateX(0%) translateY(0px)', to: 'translateX(-25%) translateY(6px)' },
  { duration: 55000, from: 'translateX(-15%) translateY(-5px)', to: 'translateX(10%) translateY(5px)' },
  { duration: 65000, from: 'translateX(-10%) translateY(3px)', to: 'translateX(5%) translateY(-4px)' },
  { duration: 75000, from: 'translateX(5%) translateY(-6px)', to: 'translateX(-20%) translateY(4px)' },
  { duration: 50000, from: 'translateX(-20%) translateY(-3px)', to: 'translateX(8%) translateY(5px)' },
  { duration: 60000, from: 'translateX(10%) translateY(2px)', to: 'translateX(-15%) translateY(-6px)' }
];

function generateClouds(category) {
  var cfg = CLOUD_CONFIGS[category];
  if (!cfg) return [];
  var clouds = [];
  var totalCount = cfg.count + (cfg.bgCount || 0);
  for (var i = 0; i < totalCount; i++) {
    var isBg = i >= cfg.count;
    var sizeFactor = isBg ? 1.3 : 1;
    var opacityFactor = isBg ? 0.5 : 1;
    var speedFactor = isBg ? 0.6 : 1;
    var size = (cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin)) * sizeFactor;
    clouds.push({
      id: category + '-' + i,
      size: size,
      height: size * (0.3 + Math.random() * 0.15),
      y: cfg.yMin + Math.random() * (cfg.yMax - cfg.yMin),
      speed: (cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin)) * speedFactor,
      offset: Math.random(),
      opacity: (cfg.opacityMin + Math.random() * (cfg.opacityMax - cfg.opacityMin)) * opacityFactor,
      dark: cfg.dark,
      isBg: isBg,
      puffs: Math.floor(3 + Math.random() * 4)
    });
  }
  return clouds;
}

function generateStars() {
  var stars = [];
  var count = 45 + Math.floor(Math.random() * 30);
  var colorClasses = ['star-white', 'star-blue', 'star-warm'];
  for (var i = 0; i < count; i++) {
    var colorRand = Math.random();
    var colorClass = colorRand < 0.55 ? 'star-white' : (colorRand < 0.78 ? 'star-blue' : 'star-warm');
    var yRand = Math.random();
    var y = yRand < 0.4 ? Math.random() * 25 : (yRand < 0.75 ? 15 + Math.random() * 25 : Math.random() * 50);
    stars.push({
      id: 'star-' + i,
      x: Math.random() * 100,
      y: y,
      size: 0.4 + Math.random() * 1.8,
      opacity: 0.2 + Math.random() * 0.6,
      twinkleDuration: 2000 + Math.random() * 5000,
      twinkleDelay: Math.random() * 4000,
      colorClass: colorClass
    });
  }
  return stars;
}

function generateFogParticles() {
  var particles = [];
  var count = 15 + Math.floor(Math.random() * 10);
  for (var i = 0; i < count; i++) {
    particles.push({
      id: 'fp-' + i,
      x: Math.random() * 100,
      y: 20 + Math.random() * 70,
      size: 30 + Math.random() * 80,
      opacity: 0.03 + Math.random() * 0.07,
      duration: 20000 + Math.random() * 30000,
      delay: Math.random() * 15000,
      direction: Math.random() < 0.5 ? 1 : -1
    });
  }
  return particles;
}

function getRainIntensity(code) {
  var num = parseInt(code, 10);
  if (isNaN(num)) return 'moderate';
  if (num === 305 || num === 309 || num === 314 || num === 399) return 'light';
  if (num === 300 || num === 306 || num === 313 || num === 315) return 'moderate';
  if (num >= 301 && num <= 318) return 'heavy';
  if (num === 200) return 'light';
  if (num === 201) return 'moderate';
  if (num >= 202 && num <= 299) return 'heavy';
  return 'moderate';
}

function getSnowIntensity(code) {
  var num = parseInt(code, 10);
  if (isNaN(num)) return 'moderate';
  if (num === 400 || num === 404 || num === 408) return 'light';
  if (num === 401 || num === 405 || num === 409) return 'moderate';
  if (num >= 402 && num <= 410) return 'heavy';
  return 'moderate';
}

export default {
  name: 'WeatherAnimation',
  props: {
    category: { type: String, default: 'cloudy' },
    weatherCode: { type: String, default: '' },
    isNight: { type: Boolean, default: false }
  },
  data: function() {
    return {
      clouds: [],
      stars: [],
      shootingStars: [],
      fogParticleList: [],
      flashActive: false,
      boltActive: false,
      boltPaths: [],
      fading: false,
      particleEngine: null,
      lightningCtrl: null,
      cloudAnimations: [],
      fogAnimations: [],
      fogParticleAnimations: [],
      starAnimations: [],
      shootingStarAnimations: [],
      sunnyAnimation: null,
      sunnyRaysAnimation: null,
      shimmerAnimation: null,
      lensFlareAnimation: null,
      moonAnimation: null,
      boltAnimation: null,
      shakeAnimation: null,
      currentCategory: '',
      resizeHandler: null,
      flashTimer: null,
      boltTimer: null,
      resizeTimer: null,
      shootingStarTimer: null
    };
  },
  computed: {
    showParticles: function() {
      return this.category === 'rain' || this.category === 'thunder' || this.category === 'snow';
    },
    showClouds: function() {
      return this.category === 'cloudy' || this.category === 'overcast' || this.category === 'thunder' || this.category === 'rain' || this.category === 'snow';
    }
  },
  watch: {
    category: function(newVal, oldVal) {
      if (newVal !== oldVal) {
        this.transitionTo(newVal);
      }
    },
    weatherCode: function() {
      this.updateParticleIntensity();
    },
    isNight: function(newVal) {
      if (newVal && (this.category === 'sunny' || this.category === 'cloudy')) {
        this.stars = generateStars();
        var self = this;
        this.$nextTick(function() {
          self.applyStarAnimations();
          self.applyMoonAnimation();
          self.startShootingStars();
        });
      } else {
        this.cancelStarAnimations();
        this.cancelShootingStarAnimations();
        this.stopShootingStars();
        this.stars = [];
        this.shootingStars = [];
        this.cancelMoonAnimation();
      }
    }
  },
  mounted: function() {
    var self = this;
    self.currentCategory = self.category;
    self.$nextTick(function() {
      self.startAnimation(self.category);
    });
    self.resizeHandler = function() {
      if (self.resizeTimer) clearTimeout(self.resizeTimer);
      self.resizeTimer = setTimeout(function() {
        if (self.particleEngine) {
          ParticleEngine.resize(self.particleEngine);
        }
      }, 200);
    };
    window.addEventListener('resize', self.resizeHandler);
  },
  beforeDestroy: function() {
    this.stopAnimation();
    this.cancelAllAnimations();
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    this.clearTimers();
  },
  methods: {
    transitionTo: function(newCategory) {
      var self = this;
      self.fading = true;
      setTimeout(function() {
        self.stopAnimation();
        self.currentCategory = newCategory;
        self.startAnimation(newCategory);
        self.$nextTick(function() {
          self.fading = false;
        });
      }, 800);
    },

    startAnimation: function(category) {
      if (category === 'rain' || category === 'thunder') {
        this.startParticles(ParticleEngine.RAIN, getRainIntensity(this.weatherCode));
      } else if (category === 'snow') {
        this.startParticles(ParticleEngine.SNOW, getSnowIntensity(this.weatherCode));
      }
      if (CLOUD_CONFIGS[category]) {
        this.clouds = generateClouds(category);
        var self = this;
        this.$nextTick(function() {
          self.applyCloudAnimations();
        });
      } else {
        this.clouds = [];
      }
      if (category === 'thunder') {
        this.startLightning();
      }
      if (category === 'fog') {
        this.fogParticleList = generateFogParticles();
        var fogSelf = this;
        this.$nextTick(function() {
          fogSelf.applyFogAnimations();
          fogSelf.applyFogParticleAnimations();
        });
      }
      if (category === 'sunny' && !this.isNight) {
        var sunnySelf = this;
        this.$nextTick(function() {
          sunnySelf.applySunnyAnimation();
          sunnySelf.applySunnyRaysAnimation();
          sunnySelf.applyShimmerAnimation();
          sunnySelf.applyLensFlareAnimation();
        });
      }
      if (this.isNight && (category === 'sunny' || category === 'cloudy')) {
        this.stars = generateStars();
        var starsSelf = this;
        this.$nextTick(function() {
          starsSelf.applyStarAnimations();
          starsSelf.applyMoonAnimation();
          starsSelf.startShootingStars();
        });
      }
    },

    stopAnimation: function() {
      this.stopParticles();
      this.stopLightning();
      this.cancelAllAnimations();
      this.stopShootingStars();
      this.clouds = [];
      this.stars = [];
      this.shootingStars = [];
      this.fogParticleList = [];
      this.flashActive = false;
      this.boltActive = false;
      this.boltPaths = [];
    },

    startParticles: function(type, intensity) {
      var canvas = this.$refs.canvas;
      if (!canvas) return;
      this.particleEngine = ParticleEngine.create(canvas, type, intensity);
      ParticleEngine.start(this.particleEngine);
    },

    stopParticles: function() {
      if (this.particleEngine) {
        ParticleEngine.destroy(this.particleEngine);
        this.particleEngine = null;
      }
    },

    updateParticleIntensity: function() {
      if (!this.particleEngine) return;
      var intensity;
      if (this.category === 'rain' || this.category === 'thunder') {
        intensity = getRainIntensity(this.weatherCode);
      } else if (this.category === 'snow') {
        intensity = getSnowIntensity(this.weatherCode);
      } else {
        return;
      }
      ParticleEngine.setIntensity(this.particleEngine, intensity);
    },

    startLightning: function() {
      var self = this;
      self.lightningCtrl = LightningCtrl.create({
        minInterval: 3000,
        maxInterval: 8000,
        doubleStrike: 0.3,
        onFlash: function() { self.triggerFlash(); },
        onBolt: function(bolt) { self.triggerBolt(bolt); }
      });
      LightningCtrl.start(self.lightningCtrl);
    },

    stopLightning: function() {
      if (this.lightningCtrl) {
        LightningCtrl.destroy(this.lightningCtrl);
        this.lightningCtrl = null;
      }
    },

    triggerFlash: function() {
      var self = this;
      self.flashActive = true;
      self.triggerShake();
      if (self.flashTimer) clearTimeout(self.flashTimer);
      self.flashTimer = setTimeout(function() {
        self.flashActive = false;
      }, 200);
    },

    triggerShake: function() {
      var el = this.$refs.animRoot;
      if (!el) return;
      if (this.shakeAnimation) {
        this.shakeAnimation.cancel();
      }
      this.shakeAnimation = el.animate([
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-2px, 1px)' },
        { transform: 'translate(3px, -1px)' },
        { transform: 'translate(-1px, 2px)' },
        { transform: 'translate(2px, -1px)' },
        { transform: 'translate(-1px, 1px)' },
        { transform: 'translate(0, 0)' }
      ], {
        duration: 300,
        easing: 'ease-out'
      });
    },

    triggerBolt: function(bolt) {
      var self = this;
      var paths = LightningCtrl.boltToPaths(bolt);
      self.boltPaths = paths;
      self.boltActive = true;
      if (self.boltTimer) clearTimeout(self.boltTimer);
      self.boltTimer = setTimeout(function() {
        self.boltActive = false;
        self.boltPaths = [];
      }, 300);
      self.$nextTick(function() {
        self.applyBoltAnimation();
      });
    },

    cloudStyle: function(cloud) {
      var size = cloud.size;
      var h = cloud.height;
      var isDark = cloud.dark;
      var isBg = cloud.isBg;
      var blur = isBg ? 8 : 0;
      var bgColor, shadowColor;
      if (isDark) {
        bgColor = 'rgba(12,20,45,' + (isBg ? 0.18 : 0.35) + ')';
        shadowColor = 'rgba(12,20,45,' + (isBg ? 0.14 : 0.28) + ')';
      } else {
        bgColor = 'rgba(255,255,255,' + (isBg ? 0.06 : 0.12) + ')';
        shadowColor = 'rgba(255,255,255,' + (isBg ? 0.05 : 0.09) + ')';
      }
      var boxShadow = [
        (size * 0.15) + 'px ' + (-h * 0.55) + 'px 0 ' + (size * 0.08) + 'px ' + shadowColor,
        (size * 0.35) + 'px ' + (-h * 0.45) + 'px 0 ' + (size * 0.12) + 'px ' + shadowColor,
        (size * 0.55) + 'px ' + (-h * 0.2) + 'px 0 ' + (size * 0.15) + 'px ' + shadowColor,
        (size * 0.7) + 'px ' + (-h * 0.05) + 'px 0 ' + (size * 0.1) + 'px ' + shadowColor,
        (-size * 0.1) + 'px ' + (-h * 0.35) + 'px 0 ' + (size * 0.09) + 'px ' + shadowColor,
        (size * 0.25) + 'px ' + (-h * 0.65) + 'px 0 ' + (size * 0.07) + 'px ' + shadowColor,
        (-size * 0.25) + 'px ' + (-h * 0.15) + 'px 0 ' + (size * 0.06) + 'px ' + shadowColor,
        (size * 0.45) + 'px ' + (-h * 0.55) + 'px 0 ' + (size * 0.09) + 'px ' + shadowColor
      ].join(',');
      return {
        width: size + 'px',
        height: h + 'px',
        left: '0',
        top: cloud.y + '%',
        opacity: cloud.opacity,
        background: bgColor,
        borderRadius: h + 'px',
        boxShadow: boxShadow,
        filter: blur > 0 ? 'blur(' + blur + 'px)' : ''
      };
    },

    starStyle: function(star) {
      return {
        left: star.x + '%',
        top: star.y + '%',
        width: star.size + 'px',
        height: star.size + 'px',
        opacity: star.opacity
      };
    },

    shootingStarStyle: function(ss) {
      return {
        left: ss.x + '%',
        top: ss.y + '%',
        width: ss.length + 'px',
        transform: 'rotate(' + ss.angle + 'deg)',
        transformOrigin: 'left center'
      };
    },

    fogParticleStyle: function(fp) {
      return {
        left: fp.x + '%',
        top: fp.y + '%',
        width: fp.size + 'px',
        height: fp.size * 0.5 + 'px',
        opacity: fp.opacity
      };
    },

    applyCloudAnimations: function() {
      var self = this;
      self.cancelCloudAnimations();
      var layer = self.$refs.cloudLayer;
      if (!layer) return;
      var cloudEls = layer.querySelectorAll('.cloud');
      cloudEls.forEach(function(el, i) {
        if (i >= self.clouds.length) return;
        var cloud = self.clouds[i];
        var bob = cloud.isBg ? 2 : 4;
        var anim = el.animate(
          [
            { transform: 'translateX(-150%) translateY(0px)' },
            { transform: 'translateX(15%) translateY(-' + bob + 'px)' },
            { transform: 'translateX(35%) translateY(' + Math.round(bob * 0.6) + 'px)' },
            { transform: 'translateX(55%) translateY(-' + Math.round(bob * 0.4) + 'px)' },
            { transform: 'translateX(75%) translateY(' + Math.round(bob * 0.2) + 'px)' },
            { transform: 'translateX(100vw) translateY(0px)' }
          ],
          {
            duration: cloud.speed * 1000,
            iterations: Infinity,
            easing: 'linear',
            delay: -(cloud.speed * cloud.offset * 1000)
          }
        );
        self.cloudAnimations.push(anim);
      });
    },

    cancelCloudAnimations: function() {
      for (var i = 0; i < this.cloudAnimations.length; i++) {
        this.cloudAnimations[i].cancel();
      }
      this.cloudAnimations = [];
    },

    applyFogAnimations: function() {
      var self = this;
      self.cancelFogAnimations();
      var layer = self.$refs.fogLayer;
      if (!layer) return;
      var fogEls = layer.querySelectorAll('.fog');
      fogEls.forEach(function(el, i) {
        if (i >= FOG_CONFIGS.length) return;
        var cfg = FOG_CONFIGS[i];
        var anim = el.animate(
          [
            { transform: cfg.from },
            { transform: cfg.to }
          ],
          {
            duration: cfg.duration,
            iterations: Infinity,
            easing: 'linear',
            direction: 'alternate'
          }
        );
        self.fogAnimations.push(anim);
      });
    },

    cancelFogAnimations: function() {
      for (var i = 0; i < this.fogAnimations.length; i++) {
        this.fogAnimations[i].cancel();
      }
      this.fogAnimations = [];
    },

    applyFogParticleAnimations: function() {
      var self = this;
      self.cancelFogParticleAnimations();
      var layer = self.$refs.fogParticles;
      if (!layer) return;
      var fpEls = layer.querySelectorAll('.fog-particle');
      fpEls.forEach(function(el, i) {
        if (i >= self.fogParticleList.length) return;
        var fp = self.fogParticleList[i];
        var moveX = fp.direction * (20 + Math.random() * 30);
        var moveY = (Math.random() - 0.5) * 10;
        var anim = el.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: fp.opacity * 0.5 },
            { transform: 'translate(' + (moveX * 0.3) + 'px, ' + (moveY * 0.3) + 'px) scale(1.1)', opacity: fp.opacity, offset: 0.3 },
            { transform: 'translate(' + (moveX * 0.7) + 'px, ' + (moveY * 0.7) + 'px) scale(0.95)', opacity: fp.opacity * 0.8, offset: 0.7 },
            { transform: 'translate(' + moveX + 'px, ' + moveY + 'px) scale(1)', opacity: fp.opacity * 0.5 }
          ],
          {
            duration: fp.duration,
            iterations: Infinity,
            easing: 'ease-in-out',
            direction: 'alternate',
            delay: fp.delay
          }
        );
        self.fogParticleAnimations.push(anim);
      });
    },

    cancelFogParticleAnimations: function() {
      for (var i = 0; i < this.fogParticleAnimations.length; i++) {
        this.fogParticleAnimations[i].cancel();
      }
      this.fogParticleAnimations = [];
    },

    applyStarAnimations: function() {
      var self = this;
      self.cancelStarAnimations();
      var layer = self.$refs.starsLayer;
      if (!layer) return;
      var starEls = layer.querySelectorAll('.star');
      starEls.forEach(function(el, i) {
        if (i >= self.stars.length) return;
        var star = self.stars[i];
        var minOp = Math.max(0.06, star.opacity * 0.15);
        var anim = el.animate(
          [
            { opacity: star.opacity },
            { opacity: minOp },
            { opacity: star.opacity }
          ],
          {
            duration: star.twinkleDuration,
            iterations: Infinity,
            easing: 'ease-in-out',
            delay: star.twinkleDelay
          }
        );
        self.starAnimations.push(anim);
      });
    },

    cancelStarAnimations: function() {
      for (var i = 0; i < this.starAnimations.length; i++) {
        this.starAnimations[i].cancel();
      }
      this.starAnimations = [];
    },

    applyMoonAnimation: function() {
      var self = this;
      self.cancelMoonAnimation();
      var el = self.$refs.moonEl;
      if (!el) return;
      self.moonAnimation = el.animate(
        [
          { opacity: 0.85, transform: 'translateY(0px)' },
          { opacity: 1, transform: 'translateY(-3px)' },
          { opacity: 0.85, transform: 'translateY(0px)' }
        ],
        {
          duration: 12000,
          iterations: Infinity,
          easing: 'ease-in-out'
        }
      );
    },

    cancelMoonAnimation: function() {
      if (this.moonAnimation) {
        this.moonAnimation.cancel();
        this.moonAnimation = null;
      }
    },

    startShootingStars: function() {
      var self = this;
      self.stopShootingStars();
      function schedule() {
        var delay = 6000 + Math.random() * 18000;
        self.shootingStarTimer = setTimeout(function() {
          if (!self.isNight) return;
          self.triggerShootingStar();
          schedule();
        }, delay);
      }
      schedule();
    },

    stopShootingStars: function() {
      if (this.shootingStarTimer) {
        clearTimeout(this.shootingStarTimer);
        this.shootingStarTimer = null;
      }
    },

    triggerShootingStar: function() {
      var id = 'shoot-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      var star = {
        id: id,
        x: 15 + Math.random() * 55,
        y: 3 + Math.random() * 25,
        angle: 25 + Math.random() * 35,
        length: 60 + Math.random() * 100,
        duration: 450 + Math.random() * 450
      };
      this.shootingStars.push(star);
      var self = this;
      this.$nextTick(function() {
        self.animateShootingStar(star);
      });
    },

    animateShootingStar: function(star) {
      var self = this;
      var layer = self.$refs.starsLayer;
      if (!layer) return;
      var el = layer.querySelector('[data-shooting-id="' + star.id + '"]');
      if (!el) return;
      var distance = 140 + Math.random() * 100;
      var rad = star.angle * Math.PI / 180;
      var dx = Math.cos(rad) * distance;
      var dy = Math.sin(rad) * distance;
      var anim = el.animate([
        { transform: 'translate(0, 0) scaleX(0)', opacity: 0 },
        { transform: 'translate(' + (dx * 0.06) + 'px, ' + (dy * 0.06) + 'px) scaleX(1)', opacity: 1, offset: 0.06 },
        { transform: 'translate(' + (dx * 0.4) + 'px, ' + (dy * 0.4) + 'px) scaleX(1)', opacity: 0.95, offset: 0.35 },
        { transform: 'translate(' + (dx * 0.7) + 'px, ' + (dy * 0.7) + 'px) scaleX(0.8)', opacity: 0.6, offset: 0.65 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scaleX(0.1)', opacity: 0 }
      ], {
        duration: star.duration,
        easing: 'ease-out',
        fill: 'forwards'
      });
      self.shootingStarAnimations.push(anim);
      anim.onfinish = function() {
        var idx = self.shootingStars.findIndex(function(s) { return s.id === star.id; });
        if (idx !== -1) self.shootingStars.splice(idx, 1);
        var aidx = self.shootingStarAnimations.indexOf(anim);
        if (aidx !== -1) self.shootingStarAnimations.splice(aidx, 1);
      };
    },

    cancelShootingStarAnimations: function() {
      for (var i = 0; i < this.shootingStarAnimations.length; i++) {
        this.shootingStarAnimations[i].cancel();
      }
      this.shootingStarAnimations = [];
    },

    applySunnyAnimation: function() {
      var self = this;
      self.cancelSunnyAnimation();
      var el = self.$refs.sunnyGlow;
      if (!el) return;
      self.sunnyAnimation = el.animate(
        [
          { opacity: 0.7, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(1.1)' },
          { opacity: 0.7, transform: 'scale(1)' }
        ],
        {
          duration: 8000,
          iterations: Infinity,
          easing: 'ease-in-out'
        }
      );
    },

    cancelSunnyAnimation: function() {
      if (this.sunnyAnimation) {
        this.sunnyAnimation.cancel();
        this.sunnyAnimation = null;
      }
    },

    applySunnyRaysAnimation: function() {
      var self = this;
      self.cancelSunnyRaysAnimation();
      var el = self.$refs.sunnyRays;
      if (!el) return;
      self.sunnyRaysAnimation = el.animate(
        [
          { transform: 'rotate(0deg)', opacity: 0.4 },
          { transform: 'rotate(360deg)', opacity: 0.4 }
        ],
        {
          duration: 120000,
          iterations: Infinity,
          easing: 'linear'
        }
      );
    },

    cancelSunnyRaysAnimation: function() {
      if (this.sunnyRaysAnimation) {
        this.sunnyRaysAnimation.cancel();
        this.sunnyRaysAnimation = null;
      }
    },

    applyShimmerAnimation: function() {
      var self = this;
      self.cancelShimmerAnimation();
      var el = self.$refs.heatShimmer;
      if (!el) return;
      self.shimmerAnimation = el.animate([
        { transform: 'scaleY(1) translateY(0)', opacity: 0.6 },
        { transform: 'scaleY(1.02) translateY(-1px)', opacity: 0.85 },
        { transform: 'scaleY(0.98) translateY(1px)', opacity: 0.5 },
        { transform: 'scaleY(1.015) translateY(-0.5px)', opacity: 0.75 },
        { transform: 'scaleY(1) translateY(0)', opacity: 0.6 }
      ], {
        duration: 4000,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
    },

    cancelShimmerAnimation: function() {
      if (this.shimmerAnimation) {
        this.shimmerAnimation.cancel();
        this.shimmerAnimation = null;
      }
    },

    applyLensFlareAnimation: function() {
      var self = this;
      self.cancelLensFlareAnimation();
      var el = self.$refs.lensFlare;
      if (!el) return;
      self.lensFlareAnimation = el.animate([
        { opacity: 0.3, transform: 'scale(1) translate(0, 0)' },
        { opacity: 0.6, transform: 'scale(1.05) translate(2px, -1px)' },
        { opacity: 0.35, transform: 'scale(0.98) translate(-1px, 1px)' },
        { opacity: 0.55, transform: 'scale(1.03) translate(1px, 0)' },
        { opacity: 0.3, transform: 'scale(1) translate(0, 0)' }
      ], {
        duration: 10000,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
    },

    cancelLensFlareAnimation: function() {
      if (this.lensFlareAnimation) {
        this.lensFlareAnimation.cancel();
        this.lensFlareAnimation = null;
      }
    },

    applyBoltAnimation: function() {
      var self = this;
      self.cancelBoltAnimation();
      var el = self.$refs.lightningSvg;
      if (!el) return;
      self.boltAnimation = el.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 0.5, offset: 0.06 },
          { opacity: 1, offset: 0.12 },
          { opacity: 0.7, offset: 0.18 },
          { opacity: 0.3, offset: 0.5 },
          { opacity: 0, offset: 1 }
        ],
        {
          duration: 400,
          easing: 'ease-out',
          fill: 'forwards'
        }
      );
    },

    cancelBoltAnimation: function() {
      if (this.boltAnimation) {
        this.boltAnimation.cancel();
        this.boltAnimation = null;
      }
    },

    cancelAllAnimations: function() {
      this.cancelCloudAnimations();
      this.cancelFogAnimations();
      this.cancelFogParticleAnimations();
      this.cancelStarAnimations();
      this.cancelShootingStarAnimations();
      this.cancelSunnyAnimation();
      this.cancelSunnyRaysAnimation();
      this.cancelShimmerAnimation();
      this.cancelLensFlareAnimation();
      this.cancelMoonAnimation();
      this.cancelBoltAnimation();
      if (this.shakeAnimation) {
        this.shakeAnimation.cancel();
        this.shakeAnimation = null;
      }
    },

    clearTimers: function() {
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.boltTimer) clearTimeout(this.boltTimer);
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      if (this.shootingStarTimer) clearTimeout(this.shootingStarTimer);
      this.flashTimer = null;
      this.boltTimer = null;
      this.resizeTimer = null;
      this.shootingStarTimer = null;
    }
  }
};
</script>

<style scoped>
.weather-animation {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  transition: opacity 0.8s var(--ease-standard);
}

.weather-animation.anim-fade {
  opacity: 0;
}

.anim-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.milky-way {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 60%;
  background:
    linear-gradient(135deg,
      transparent 0%,
      transparent 18%,
      rgba(180,190,230,0.02) 25%,
      rgba(190,200,240,0.035) 35%,
      rgba(200,210,245,0.045) 43%,
      rgba(210,218,250,0.05) 48%,
      rgba(205,212,248,0.04) 53%,
      rgba(195,205,240,0.03) 60%,
      rgba(185,198,235,0.02) 68%,
      transparent 75%,
      transparent 100%
    );
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0) 100%);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0) 100%);
}

.stars-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 60%;
  overflow: hidden;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.8) 60%, rgba(0,0,0,0.2) 85%, rgba(0,0,0,0) 100%);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.8) 60%, rgba(0,0,0,0.2) 85%, rgba(0,0,0,0) 100%);
}

.star {
  position: absolute;
  border-radius: 50%;
  will-change: opacity;
}

.star-white {
  background: radial-gradient(circle, #fff 0%, rgba(255,255,255,0.6) 60%, transparent 100%);
}

.star-blue {
  background: radial-gradient(circle, #cce0ff 0%, rgba(200,220,255,0.5) 60%, transparent 100%);
}

.star-warm {
  background: radial-gradient(circle, #fff5e0 0%, rgba(255,240,210,0.5) 60%, transparent 100%);
}

.shooting-star {
  position: absolute;
  height: 1.5px;
  background: linear-gradient(90deg, rgba(255,255,255,0.98), rgba(210,225,255,0.7) 10%, rgba(190,210,255,0.35) 35%, rgba(170,195,255,0.1) 65%, transparent 90%);
  border-radius: 1px;
  pointer-events: none;
  will-change: transform, opacity;
}

.moon {
  position: absolute;
  top: 8%;
  right: 14%;
  width: 42px;
  height: 42px;
  pointer-events: none;
}

.moon-body {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #faf6ed, #ede4d0 50%, #ddd2bc);
  position: relative;
  z-index: 1;
  overflow: hidden;
}

.moon-body::after {
  content: '';
  position: absolute;
  top: -4px;
  left: 11px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(10,16,53,0.97), rgba(15,22,60,0.95));
}

.moon-crater {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(200,190,170,0.3), rgba(190,180,160,0.15));
  z-index: 0;
}

.crater-1 {
  width: 6px;
  height: 6px;
  top: 14px;
  left: 4px;
}

.crater-2 {
  width: 4px;
  height: 4px;
  top: 24px;
  left: 7px;
}

.crater-3 {
  width: 3px;
  height: 3px;
  top: 10px;
  left: 8px;
}

.crater-4 {
  width: 2px;
  height: 2px;
  top: 20px;
  left: 2px;
}

.moon-glow {
  position: absolute;
  top: -22px;
  left: -22px;
  width: 86px;
  height: 86px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(250,246,237,0.18) 0%, rgba(250,246,237,0.07) 35%, rgba(250,246,237,0.02) 60%, transparent 75%);
  z-index: 0;
}

.moon-glow-outer {
  position: absolute;
  top: -42px;
  left: -42px;
  width: 126px;
  height: 126px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(250,246,237,0.06) 0%, rgba(250,246,237,0.025) 35%, rgba(250,246,237,0.008) 55%, transparent 72%);
  z-index: -1;
}

.cloud-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 60%;
  overflow: visible;
}

.cloud {
  position: absolute;
  border-radius: var(--radius-pill);
  will-change: transform;
}

.cloud-bg {
  z-index: -1;
}

.sunny-glow {
  position: absolute;
  top: -20%;
  right: -10%;
  width: 60%;
  height: 60%;
  background: radial-gradient(circle, rgba(255, 220, 100, 0.2) 0%, rgba(255, 200, 80, 0.08) 35%, rgba(255, 180, 60, 0.03) 55%, transparent 70%);
  pointer-events: none;
}

.sunny-glow-inner {
  position: absolute;
  top: -10%;
  right: -5%;
  width: 40%;
  height: 40%;
  background: radial-gradient(circle, rgba(255, 235, 150, 0.12) 0%, rgba(255, 220, 100, 0.04) 40%, transparent 65%);
  pointer-events: none;
}

.sunny-rays {
  position: absolute;
  top: -40%;
  right: -25%;
  width: 90%;
  height: 90%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg, rgba(255,220,100,0.05) 3deg, transparent 6deg,
    transparent 15deg, rgba(255,220,100,0.04) 18deg, transparent 21deg,
    transparent 30deg, rgba(255,220,100,0.05) 33deg, transparent 36deg,
    transparent 45deg, rgba(255,220,100,0.04) 48deg, transparent 51deg,
    transparent 60deg, rgba(255,220,100,0.05) 63deg, transparent 66deg,
    transparent 75deg, rgba(255,220,100,0.04) 78deg, transparent 81deg,
    transparent 90deg, rgba(255,220,100,0.05) 93deg, transparent 96deg,
    transparent 105deg, rgba(255,220,100,0.04) 108deg, transparent 111deg,
    transparent 120deg, rgba(255,220,100,0.05) 123deg, transparent 126deg,
    transparent 135deg, rgba(255,220,100,0.04) 138deg, transparent 141deg,
    transparent 150deg, rgba(255,220,100,0.05) 153deg, transparent 156deg,
    transparent 165deg, rgba(255,220,100,0.04) 168deg, transparent 171deg,
    transparent 180deg, rgba(255,220,100,0.05) 183deg, transparent 186deg,
    transparent 195deg, rgba(255,220,100,0.04) 198deg, transparent 201deg,
    transparent 210deg, rgba(255,220,100,0.05) 213deg, transparent 216deg,
    transparent 225deg, rgba(255,220,100,0.04) 228deg, transparent 231deg,
    transparent 240deg, rgba(255,220,100,0.05) 243deg, transparent 246deg,
    transparent 255deg, rgba(255,220,100,0.04) 258deg, transparent 261deg,
    transparent 270deg, rgba(255,220,100,0.05) 273deg, transparent 276deg,
    transparent 285deg, rgba(255,220,100,0.04) 288deg, transparent 291deg,
    transparent 300deg, rgba(255,220,100,0.05) 303deg, transparent 306deg,
    transparent 315deg, rgba(255,220,100,0.04) 318deg, transparent 321deg,
    transparent 330deg, rgba(255,220,100,0.05) 333deg, transparent 336deg,
    transparent 345deg, rgba(255,220,100,0.04) 348deg, transparent 351deg,
    transparent 360deg
  );
  pointer-events: none;
  will-change: transform;
}

.lens-flare {
  position: absolute;
  top: -5%;
  right: 0%;
  width: 50%;
  height: 50%;
  pointer-events: none;
}

.flare-ring {
  position: absolute;
  border-radius: 50%;
  border-style: solid;
  border-color: rgba(255,220,150,0.08);
}

.flare-ring-1 {
  width: 40px;
  height: 40px;
  top: 30%;
  left: 35%;
  border-width: 1.5px;
  border-color: rgba(255,200,100,0.06);
}

.flare-ring-2 {
  width: 22px;
  height: 22px;
  top: 45%;
  left: 50%;
  border-width: 1px;
  border-color: rgba(255,180,80,0.08);
}

.flare-ring-3 {
  width: 60px;
  height: 60px;
  top: 55%;
  left: 60%;
  border-width: 1px;
  border-color: rgba(255,160,60,0.04);
}

.flare-dot {
  position: absolute;
  border-radius: 50%;
}

.flare-dot-1 {
  width: 6px;
  height: 6px;
  top: 40%;
  left: 45%;
  background: radial-gradient(circle, rgba(255,230,150,0.2), rgba(255,200,100,0.05), transparent);
}

.flare-dot-2 {
  width: 4px;
  height: 4px;
  top: 52%;
  left: 55%;
  background: radial-gradient(circle, rgba(255,180,80,0.15), rgba(255,160,60,0.04), transparent);
}

.flare-dot-3 {
  width: 8px;
  height: 8px;
  top: 60%;
  left: 65%;
  background: radial-gradient(circle, rgba(255,200,120,0.1), rgba(255,180,100,0.03), transparent);
}

.heat-shimmer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 25%;
  background: linear-gradient(to top, rgba(255,210,120,0.05), rgba(255,200,100,0.02) 40%, transparent 80%);
  pointer-events: none;
  will-change: transform, opacity;
}

.lightning-flash {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(200, 215, 255, 0.4);
  opacity: 0;
  transition: opacity 0.25s var(--ease-standard);
  pointer-events: none;
}

.lightning-flash.active {
  opacity: 1;
  transition: opacity 0.015s var(--ease-accelerate);
}

.lightning-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 70%;
  pointer-events: none;
  filter: drop-shadow(0 0 8px rgba(180, 200, 255, 0.95)) drop-shadow(0 0 20px rgba(150, 180, 255, 0.6)) drop-shadow(0 0 40px rgba(130, 160, 255, 0.25));
}

.fog-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.fog {
  position: absolute;
  width: 200%;
  height: 100%;
  top: 0;
  left: -50%;
}

.fog-1 {
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(200,215,230,0.08) 12%,
    rgba(200,215,230,0.16) 35%,
    rgba(200,215,230,0.2) 50%,
    rgba(200,215,230,0.16) 65%,
    rgba(200,215,230,0.08) 82%,
    transparent 95%
  );
}

.fog-2 {
  background: linear-gradient(90deg,
    transparent 5%,
    rgba(200,215,230,0.06) 25%,
    rgba(200,215,230,0.12) 50%,
    rgba(200,215,230,0.06) 72%,
    transparent 90%
  );
  top: 12%;
}

.fog-3 {
  background: linear-gradient(90deg,
    transparent 2%,
    rgba(210,220,235,0.09) 20%,
    rgba(210,220,235,0.18) 45%,
    rgba(210,220,235,0.22) 55%,
    rgba(210,220,235,0.14) 70%,
    rgba(210,220,235,0.06) 85%,
    transparent 95%
  );
  top: 25%;
}

.fog-4 {
  background: linear-gradient(90deg,
    transparent 10%,
    rgba(210,220,235,0.05) 35%,
    rgba(210,220,235,0.1) 55%,
    rgba(210,220,235,0.05) 75%,
    transparent 90%
  );
  top: 40%;
  opacity: 0.85;
}

.fog-5 {
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(220,225,240,0.06) 18%,
    rgba(220,225,240,0.13) 42%,
    rgba(220,225,240,0.16) 52%,
    rgba(220,225,240,0.09) 68%,
    rgba(220,225,240,0.04) 82%,
    transparent 95%
  );
  top: 55%;
  opacity: 0.7;
}

.fog-6 {
  background: linear-gradient(90deg,
    transparent 8%,
    rgba(215,222,238,0.07) 30%,
    rgba(215,222,238,0.14) 50%,
    rgba(215,222,238,0.07) 70%,
    transparent 92%
  );
  top: 70%;
  opacity: 0.6;
}

.fog-7 {
  background: linear-gradient(90deg,
    transparent 3%,
    rgba(225,228,242,0.08) 22%,
    rgba(225,228,242,0.16) 45%,
    rgba(225,228,242,0.2) 55%,
    rgba(225,228,242,0.12) 68%,
    rgba(225,228,242,0.05) 82%,
    transparent 95%
  );
  top: 85%;
  opacity: 0.5;
}

.fog-particles {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.fog-particle {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(210,220,235,0.12), rgba(200,215,230,0.05) 45%, transparent 70%);
  will-change: transform, opacity;
}
</style>
