var ParticleEngine = {};

ParticleEngine.RAIN = 'rain';
ParticleEngine.SNOW = 'snow';

ParticleEngine.RAIN_CONFIGS = {
  light: {
    count: 80,
    speedMin: 8, speedMax: 14,
    lengthMin: 4, lengthMax: 10,
    widthMin: 1.5, widthMax: 2.8,
    opacityMin: 0.12, opacityMax: 0.35,
    wind: 0.6,
    angleMin: -5, angleMax: 5,
    splashRate: 0.15,
    maxSplash: 12,
    maxRipples: 15,
    rippleRate: 0.12,
    maxBounceDrops: 8,
    mistOpacity: 0.0,
    veilOpacity: 0.0,
    puddleOpacity: 0.0,
    bgCount: 25,
    bgSpeedFactor: 0.4,
    bgOpacityFactor: 0.3,
    bgLengthFactor: 0.6
  },
  moderate: {
    count: 160,
    speedMin: 12, speedMax: 20,
    lengthMin: 6, lengthMax: 14,
    widthMin: 1.8, widthMax: 3.2,
    opacityMin: 0.15, opacityMax: 0.4,
    wind: 1.0,
    angleMin: -8, angleMax: 8,
    splashRate: 0.3,
    maxSplash: 25,
    maxRipples: 30,
    rippleRate: 0.2,
    maxBounceDrops: 15,
    mistOpacity: 0.02,
    veilOpacity: 0.0,
    puddleOpacity: 0.015,
    bgCount: 50,
    bgSpeedFactor: 0.45,
    bgOpacityFactor: 0.3,
    bgLengthFactor: 0.65
  },
  heavy: {
    count: 280,
    speedMin: 16, speedMax: 28,
    lengthMin: 8, lengthMax: 18,
    widthMin: 2.2, widthMax: 4.0,
    opacityMin: 0.18, opacityMax: 0.5,
    wind: 1.5,
    angleMin: -12, angleMax: 12,
    splashRate: 0.45,
    maxSplash: 45,
    maxRipples: 50,
    rippleRate: 0.3,
    maxBounceDrops: 25,
    mistOpacity: 0.04,
    veilOpacity: 0.03,
    puddleOpacity: 0.03,
    bgCount: 80,
    bgSpeedFactor: 0.5,
    bgOpacityFactor: 0.25,
    bgLengthFactor: 0.7
  }
};

ParticleEngine.SNOW_CONFIGS = {
  light: {
    count: 55,
    speedMin: 0.5, speedMax: 1.6,
    sizeMin: 1.5, sizeMax: 3.5,
    opacityMin: 0.3, opacityMax: 0.65,
    drift: 0.4,
    wobble: 0.018,
    rotation: true,
    groundOpacity: 0.0,
    bgCount: 22,
    bgSpeedFactor: 0.35,
    bgOpacityFactor: 0.3,
    bgSizeFactor: 0.6
  },
  moderate: {
    count: 110,
    speedMin: 0.8, speedMax: 2.2,
    sizeMin: 2, sizeMax: 4.5,
    opacityMin: 0.3, opacityMax: 0.75,
    drift: 0.7,
    wobble: 0.025,
    rotation: true,
    groundOpacity: 0.02,
    bgCount: 45,
    bgSpeedFactor: 0.4,
    bgOpacityFactor: 0.3,
    bgSizeFactor: 0.65
  },
  heavy: {
    count: 200,
    speedMin: 1.2, speedMax: 3.2,
    sizeMin: 2.5, sizeMax: 5.5,
    opacityMin: 0.35, opacityMax: 0.85,
    drift: 1.0,
    wobble: 0.035,
    rotation: true,
    groundOpacity: 0.04,
    bgCount: 80,
    bgSpeedFactor: 0.45,
    bgOpacityFactor: 0.25,
    bgSizeFactor: 0.7
  }
};

ParticleEngine.create = function(canvas, type, intensity) {
  var isRain = type === ParticleEngine.RAIN;
  var configs = isRain ? ParticleEngine.RAIN_CONFIGS : ParticleEngine.SNOW_CONFIGS;
  var config = configs[intensity] || configs.moderate;
  return {
    canvas: canvas,
    ctx: null,
    type: type,
    intensity: intensity,
    config: config,
    particles: [],
    bgParticles: [],
    splashes: [],
    ripples: [],
    bounceDrops: [],
    running: false,
    raf: null,
    lastTime: 0,
    width: 0,
    height: 0,
    dpr: 1,
    windGust: 0,
    windGustPhase: Math.random() * Math.PI * 2,
    windGustFreq: 0.0004 + Math.random() * 0.0002,
    globalTime: 0,
    windAngle: 0,
    windAngleTarget: 0,
    windAnglePhase: Math.random() * Math.PI * 2
  };
};

ParticleEngine.resize = function(eng) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  eng.dpr = dpr;
  eng.width = eng.canvas.offsetWidth;
  eng.height = eng.canvas.offsetHeight;
  eng.canvas.width = Math.round(eng.width * dpr);
  eng.canvas.height = Math.round(eng.height * dpr);
  eng.ctx = eng.canvas.getContext('2d');
  eng.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

ParticleEngine.createRainDrop = function(eng, randomY, isBg) {
  var c = eng.config;
  var speed, length, width, opacity, wind;
  if (isBg) {
    speed = (c.speedMin + Math.random() * (c.speedMax - c.speedMin)) * c.bgSpeedFactor;
    length = (c.lengthMin + Math.random() * (c.lengthMax - c.lengthMin)) * c.bgLengthFactor;
    width = c.widthMin * 0.7 + Math.random() * (c.widthMax - c.widthMin) * 0.4;
    opacity = (c.opacityMin + Math.random() * (c.opacityMax - c.opacityMin)) * c.bgOpacityFactor;
    wind = c.wind * 0.5 * (0.7 + Math.random() * 0.6);
  } else {
    speed = c.speedMin + Math.random() * (c.speedMax - c.speedMin);
    length = c.lengthMin + Math.random() * (c.lengthMax - c.lengthMin);
    width = c.widthMin + Math.random() * (c.widthMax - c.widthMin);
    opacity = c.opacityMin + Math.random() * (c.opacityMax - c.opacityMin);
    wind = c.wind * (0.7 + Math.random() * 0.6);
  }
  var angleRange = c.angleMax - c.angleMin;
  var baseAngle = c.angleMin + Math.random() * angleRange;
  return {
    x: Math.random() * (eng.width + 100) - 50,
    y: randomY ? Math.random() * eng.height : -(Math.random() * eng.height * 0.5),
    speed: speed,
    length: length,
    width: width,
    opacity: opacity,
    wind: wind,
    baseAngle: baseAngle,
    windPhase: Math.random() * Math.PI * 2,
    windFreq: 0.001 + Math.random() * 0.002,
    isBg: !!isBg
  };
};

ParticleEngine.createSnowFlake = function(eng, randomY, isBg) {
  var c = eng.config;
  var speed, size, opacity, drift;
  if (isBg) {
    speed = (c.speedMin + Math.random() * (c.speedMax - c.speedMin)) * c.bgSpeedFactor;
    size = (c.sizeMin + Math.random() * (c.sizeMax - c.sizeMin)) * c.bgSizeFactor;
    opacity = (c.opacityMin + Math.random() * (c.opacityMax - c.opacityMin)) * c.bgOpacityFactor;
    drift = c.drift * 0.5 * (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
  } else {
    speed = c.speedMin + Math.random() * (c.speedMax - c.speedMin);
    size = c.sizeMin + Math.random() * (c.sizeMax - c.sizeMin);
    opacity = c.opacityMin + Math.random() * (c.opacityMax - c.opacityMin);
    drift = c.drift * (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
  }
  var shapeType = 0;
  if (size >= 3.5) {
    var r = Math.random();
    if (r < 0.4) shapeType = 1;
    else if (r < 0.7) shapeType = 2;
    else shapeType = 3;
  } else if (size >= 2.5) {
    shapeType = Math.random() < 0.5 ? 1 : 0;
  }
  return {
    x: Math.random() * eng.width,
    y: randomY ? Math.random() * eng.height : -(Math.random() * eng.height * 0.3),
    speed: speed,
    size: size,
    opacity: opacity,
    drift: drift,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: c.wobble * (0.8 + Math.random() * 0.4),
    wobbleAmp: 0.3 + Math.random() * 0.4,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
    isBg: !!isBg,
    sparklePhase: Math.random() * Math.PI * 2,
    sparkleSpeed: 0.003 + Math.random() * 0.005,
    depthLayer: Math.random(),
    shapeType: shapeType
  };
};

ParticleEngine.start = function(eng) {
  if (eng.running) return;
  eng.running = true;
  ParticleEngine.resize(eng);
  eng.particles = [];
  eng.bgParticles = [];
  eng.splashes = [];
  eng.ripples = [];
  eng.bounceDrops = [];
  var isRain = eng.type === ParticleEngine.RAIN;
  var c = eng.config;
  for (var i = 0; i < c.count; i++) {
    if (isRain) {
      eng.particles.push(ParticleEngine.createRainDrop(eng, true, false));
    } else {
      eng.particles.push(ParticleEngine.createSnowFlake(eng, true, false));
    }
  }
  var bgCount = c.bgCount || 0;
  for (var j = 0; j < bgCount; j++) {
    if (isRain) {
      eng.bgParticles.push(ParticleEngine.createRainDrop(eng, true, true));
    } else {
      eng.bgParticles.push(ParticleEngine.createSnowFlake(eng, true, true));
    }
  }
  eng.lastTime = performance.now();
  eng.globalTime = 0;
  eng.windAngle = 0;
  eng.windAngleTarget = 0;
  ParticleEngine.loop(eng);
};

// 软暂停：滚动期间冻结粒子更新（保留最后一帧），恢复时从当前帧继续，不重新播种
ParticleEngine.setPaused = function(eng, paused) {
  eng.paused = !!paused;
  if (!paused) eng.lastTime = performance.now();  // 防止恢复瞬间 dt 突跳
};

ParticleEngine.loop = function(eng) {
  if (!eng.running) return;
  eng.raf = requestAnimationFrame(function() { ParticleEngine.loop(eng); });
  var now = performance.now();
  var dt = Math.min((now - eng.lastTime) / 16.67, 3);
  eng.lastTime = now;
  if (eng.paused) return;  // 冻结：跳过更新与绘制，保留画布最后一帧
  eng.globalTime += dt;
  if (eng.type === ParticleEngine.RAIN) {
    ParticleEngine.updateRain(eng, dt);
  } else {
    ParticleEngine.updateSnow(eng, dt);
  }
  ParticleEngine.draw(eng);
};

ParticleEngine.updateRain = function(eng, dt) {
  var h = eng.height;
  var c = eng.config;
  var i, d, nd, s;
  eng.windGustPhase += eng.windGustFreq * dt * 16.67;
  eng.windGust = Math.sin(eng.windGustPhase) * 0.35 + Math.sin(eng.windGustPhase * 2.7) * 0.15 + Math.sin(eng.windGustPhase * 0.3) * 0.2;
  var gustWind = eng.windGust * c.wind;
  eng.windAnglePhase += 0.00008 * dt * 16.67;
  eng.windAngleTarget = Math.sin(eng.windAnglePhase) * 6 + Math.sin(eng.windAnglePhase * 2.3) * 3;
  eng.windAngle += (eng.windAngleTarget - eng.windAngle) * 0.01 * dt;
  var currentAngle = eng.windAngle;
  for (i = 0; i < eng.bgParticles.length; i++) {
    d = eng.bgParticles[i];
    d.y += d.speed * dt;
    d.windPhase += d.windFreq * dt * 16.67;
    var perParticleWind = Math.sin(d.windPhase) * 0.15;
    d.x += (d.wind + gustWind * 0.5 + perParticleWind) * dt;
    if (d.y > h + 5) {
      nd = ParticleEngine.createRainDrop(eng, false, true);
      nd.y = -nd.length - Math.random() * 30;
      eng.bgParticles[i] = nd;
    }
  }
  for (i = 0; i < eng.particles.length; i++) {
    d = eng.particles[i];
    d.y += d.speed * dt;
    d.windPhase += d.windFreq * dt * 16.67;
    var ppWind = Math.sin(d.windPhase) * 0.2;
    d.x += (d.wind + gustWind + ppWind) * dt;
    if (d.y > h + 5) {
      if (eng.splashes.length < c.maxSplash && Math.random() < c.splashRate) {
        var splashDroplets = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 3) : 0;
        var windDir = gustWind > 0 ? 1 : -1;
        eng.splashes.push({
          x: d.x,
          y: h - 1,
          radius: 0.5,
          maxRadius: 2.5 + Math.random() * 4,
          opacity: 0.25 + Math.random() * 0.2,
          droplets: splashDroplets,
          impactLen: 2 + Math.random() * 3,
          impactOpacity: 0.3 + Math.random() * 0.15,
          hasSecondRing: Math.random() < 0.3,
          windDir: windDir
        });
      }
      if (eng.ripples.length < c.maxRipples && Math.random() < (c.rippleRate || 0.2)) {
        eng.ripples.push({
          x: d.x,
          y: h - 1 - Math.random() * 2,
          radius: 0.5,
          maxRadius: 5 + Math.random() * 8,
          opacity: 0.15 + Math.random() * 0.1,
          lineWidth: 0.3 + Math.random() * 0.25,
          hasInner: Math.random() < 0.4,
          innerRadius: 0,
          innerMaxRadius: 2 + Math.random() * 3,
          innerDelay: 3
        });
      }
      if (eng.bounceDrops.length < (c.maxBounceDrops || 0) && Math.random() < 0.08) {
        var bounceCount = 1 + Math.floor(Math.random() * 2);
        for (var bi = 0; bi < bounceCount; bi++) {
          var bWindDir = gustWind > 0 ? 1 : -1;
          eng.bounceDrops.push({
            x: d.x + (Math.random() - 0.5) * 4,
            y: h - 2,
            vx: (Math.random() - 0.3 + bWindDir * 0.3) * 2.5,
            vy: -(1.5 + Math.random() * 2.5),
            gravity: 0.12 + Math.random() * 0.04,
            size: 0.4 + Math.random() * 0.6,
            opacity: 0.3 + Math.random() * 0.2,
            life: 1.0
          });
        }
      }
      nd = ParticleEngine.createRainDrop(eng, false, false);
      nd.y = -nd.length - Math.random() * 20;
      eng.particles[i] = nd;
    }
  }
  for (var j = eng.splashes.length - 1; j >= 0; j--) {
    s = eng.splashes[j];
    s.radius += 0.3 * dt;
    s.opacity -= 0.02 * dt;
    if (s.impactLen > 0) {
      s.impactLen -= 0.2 * dt;
      s.impactOpacity -= 0.025 * dt;
    }
    if (s.opacity <= 0 || s.radius >= s.maxRadius) {
      eng.splashes.splice(j, 1);
    }
  }
  for (var r = eng.ripples.length - 1; r >= 0; r--) {
    var rp = eng.ripples[r];
    rp.radius += 0.15 * dt;
    rp.opacity -= 0.007 * dt;
    if (rp.hasInner) {
      if (rp.innerDelay > 0) {
        rp.innerDelay -= dt;
      } else {
        rp.innerRadius += 0.12 * dt;
      }
    }
    if (rp.opacity <= 0 || rp.radius >= rp.maxRadius) {
      eng.ripples.splice(r, 1);
    }
  }
  for (var b = eng.bounceDrops.length - 1; b >= 0; b--) {
    var bd = eng.bounceDrops[b];
    bd.vy += bd.gravity * dt;
    bd.x += bd.vx * dt;
    bd.y += bd.vy * dt;
    bd.life -= 0.025 * dt;
    bd.opacity *= (1 - 0.015 * dt);
    if (bd.life <= 0 || bd.y > h + 2) {
      eng.bounceDrops.splice(b, 1);
    }
  }
};

ParticleEngine.updateSnow = function(eng, dt) {
  var w = eng.width;
  var h = eng.height;
  var i, f, nf;
  eng.windGustPhase += eng.windGustFreq * dt * 16.67;
  eng.windGust = Math.sin(eng.windGustPhase) * 0.3 + Math.sin(eng.windGustPhase * 2.3) * 0.12 + Math.sin(eng.windGustPhase * 0.7) * 0.08;
  var gustDrift = eng.windGust * (eng.config.drift || 0.5) * 0.3;
  for (i = 0; i < eng.bgParticles.length; i++) {
    f = eng.bgParticles[i];
    f.y += f.speed * dt;
    f.wobblePhase += f.wobbleSpeed * dt;
    var wobbleX = Math.sin(f.wobblePhase) * f.wobbleAmp * 0.6;
    f.x += (f.drift + gustDrift + wobbleX) * dt;
    f.rotation += f.rotSpeed * dt;
    f.sparklePhase += f.sparkleSpeed * dt * 16.67;
    if (f.y > h + 5 || f.x < -10 || f.x > w + 10) {
      nf = ParticleEngine.createSnowFlake(eng, false, true);
      nf.y = -nf.size;
      eng.bgParticles[i] = nf;
    }
  }
  for (i = 0; i < eng.particles.length; i++) {
    f = eng.particles[i];
    f.y += f.speed * dt;
    f.wobblePhase += f.wobbleSpeed * dt;
    var wobX = Math.sin(f.wobblePhase) * f.wobbleAmp;
    f.x += (f.drift + gustDrift + wobX) * dt;
    f.rotation += f.rotSpeed * dt;
    f.sparklePhase += f.sparkleSpeed * dt * 16.67;
    if (f.y > h + 5 || f.x < -10 || f.x > w + 10) {
      nf = ParticleEngine.createSnowFlake(eng, false, false);
      nf.y = -nf.size;
      eng.particles[i] = nf;
    }
  }
};

ParticleEngine.draw = function(eng) {
  eng.ctx.clearRect(0, 0, eng.width, eng.height);
  if (eng.type === ParticleEngine.RAIN) {
    ParticleEngine.drawRain(eng);
  } else {
    ParticleEngine.drawSnow(eng);
  }
};

ParticleEngine.drawRain = function(eng) {
  var ctx = eng.ctx;
  var c = eng.config;
  var i, d, s;
  var currentAngle = eng.windAngle;
  for (i = 0; i < eng.bgParticles.length; i++) {
    d = eng.bgParticles[i];
    var bgAngleRad = (currentAngle * 0.6 + d.baseAngle * 0.5) * Math.PI / 180;
    var bgTailX = d.x + Math.sin(bgAngleRad) * d.length + d.wind * (d.length / d.speed) * 0.5;
    var bgTailY = d.y + d.length * Math.cos(bgAngleRad);
    var bgMidX = (d.x + bgTailX) * 0.5;
    var bgMidY = (d.y + bgTailY) * 0.5;
    var bgGrad = ctx.createLinearGradient(d.x, d.y, bgTailX, bgTailY);
    bgGrad.addColorStop(0, 'rgba(190,215,245,' + Math.min(1, d.opacity * 1.4).toFixed(3) + ')');
    bgGrad.addColorStop(0.4, 'rgba(170,200,240,' + (d.opacity * 0.8).toFixed(3) + ')');
    bgGrad.addColorStop(1, 'rgba(150,185,230,' + (d.opacity * 0.15).toFixed(3) + ')');
    ctx.beginPath();
    ctx.ellipse(bgMidX, bgMidY, d.width * 0.6, d.length * 0.5, Math.atan2(bgTailY - d.y, bgTailX - d.x) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();
  }
  for (i = 0; i < eng.particles.length; i++) {
    d = eng.particles[i];
    var dropAngle = d.baseAngle + currentAngle;
    var dropAngleRad = dropAngle * Math.PI / 180;
    var tailOffsetX = Math.sin(dropAngleRad) * d.length + d.wind * (d.length / d.speed);
    var tailX = d.x + tailOffsetX;
    var tailY = d.y + d.length * Math.cos(dropAngleRad);
    var midX = (d.x + tailX) * 0.5;
    var midY = (d.y + tailY) * 0.5;
    var angle = Math.atan2(tailY - d.y, tailX - d.x) + Math.PI / 2;
    var grad = ctx.createLinearGradient(d.x, d.y, tailX, tailY);
    grad.addColorStop(0, 'rgba(220,235,255,' + Math.min(1, d.opacity * 2.0).toFixed(3) + ')');
    grad.addColorStop(0.25, 'rgba(195,218,250,' + Math.min(1, d.opacity * 1.5).toFixed(3) + ')');
    grad.addColorStop(0.6, 'rgba(175,205,245,' + (d.opacity * 0.9).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(155,190,240,' + (d.opacity * 0.1).toFixed(3) + ')');
    ctx.beginPath();
    ctx.ellipse(midX, midY, d.width * 0.7, d.length * 0.5, angle, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.width * 0.55, d.width * 0.7, angle, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230,242,255,' + Math.min(1, d.opacity * 2.2).toFixed(3) + ')';
    ctx.fill();
    if (d.width > 2.5 && d.opacity > 0.25) {
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.width * 1.5, d.width * 1.8, angle, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(210,230,255,' + (d.opacity * 0.08).toFixed(3) + ')';
      ctx.fill();
    }
  }
  for (var j = 0; j < eng.splashes.length; j++) {
    s = eng.splashes[j];
    if (s.impactLen > 0 && s.impactOpacity > 0) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x, s.y - s.impactLen);
      ctx.strokeStyle = 'rgba(200,225,255,' + Math.max(0, s.impactOpacity).toFixed(3) + ')';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, Math.PI, 0, false);
    ctx.strokeStyle = 'rgba(190,220,255,' + Math.max(0, s.opacity).toFixed(3) + ')';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    if (s.hasSecondRing && s.radius > s.maxRadius * 0.4) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * 0.5, Math.PI, 0, false);
      ctx.strokeStyle = 'rgba(190,220,255,' + Math.max(0, s.opacity * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
    if (s.droplets > 0) {
      for (var k = 0; k < s.droplets; k++) {
        var angle = Math.PI + (Math.PI / (s.droplets + 1)) * (k + 1);
        var windBias = (s.windDir || 0) * 0.15;
        var dx = Math.cos(angle + windBias) * s.radius * 0.8;
        var dy = Math.sin(angle) * s.radius * 0.5;
        ctx.beginPath();
        ctx.arc(s.x + dx, s.y + dy, 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(190,220,255,' + Math.max(0, s.opacity * 0.7).toFixed(3) + ')';
        ctx.fill();
      }
    }
  }
  for (var ri = 0; ri < eng.ripples.length; ri++) {
    var rp = eng.ripples[ri];
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.radius, rp.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180,210,250,' + Math.max(0, rp.opacity).toFixed(3) + ')';
    ctx.lineWidth = rp.lineWidth;
    ctx.stroke();
    if (rp.hasInner && rp.innerDelay <= 0 && rp.innerRadius > 0) {
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.innerRadius, rp.innerRadius * 0.35, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(180,210,250,' + Math.max(0, rp.opacity * 0.6).toFixed(3) + ')';
      ctx.lineWidth = rp.lineWidth * 0.7;
      ctx.stroke();
    }
  }
  for (var bi = 0; bi < eng.bounceDrops.length; bi++) {
    var bd = eng.bounceDrops[bi];
    var bdOp = Math.max(0, bd.opacity * bd.life);
    ctx.beginPath();
    ctx.arc(bd.x, bd.y, bd.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,225,255,' + bdOp.toFixed(3) + ')';
    ctx.fill();
    if (bd.size > 0.6 && bdOp > 0.15) {
      ctx.beginPath();
      ctx.arc(bd.x, bd.y, bd.size * 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,225,255,' + (bdOp * 0.12).toFixed(3) + ')';
      ctx.fill();
    }
  }
  if (c.puddleOpacity > 0) {
    var puddleGrad = ctx.createLinearGradient(0, eng.height * 0.88, 0, eng.height);
    puddleGrad.addColorStop(0, 'rgba(140,175,210,0)');
    puddleGrad.addColorStop(0.3, 'rgba(140,175,210,' + (c.puddleOpacity * 0.3).toFixed(4) + ')');
    puddleGrad.addColorStop(0.7, 'rgba(130,165,200,' + (c.puddleOpacity * 0.6).toFixed(4) + ')');
    puddleGrad.addColorStop(1, 'rgba(120,155,195,' + c.puddleOpacity.toFixed(4) + ')');
    ctx.fillStyle = puddleGrad;
    ctx.fillRect(0, eng.height * 0.88, eng.width, eng.height * 0.12);
    if (c.puddleOpacity > 0.01) {
      var shimmerX = (eng.globalTime * 0.3) % (eng.width + 200) - 100;
      var shimGrad = ctx.createRadialGradient(shimmerX, eng.height * 0.94, 0, shimmerX, eng.height * 0.94, 60);
      shimGrad.addColorStop(0, 'rgba(180,210,240,' + (c.puddleOpacity * 0.3).toFixed(4) + ')');
      shimGrad.addColorStop(0.5, 'rgba(170,200,230,' + (c.puddleOpacity * 0.1).toFixed(4) + ')');
      shimGrad.addColorStop(1, 'rgba(160,190,220,0)');
      ctx.fillStyle = shimGrad;
      ctx.fillRect(0, eng.height * 0.88, eng.width, eng.height * 0.12);
      var shimmer2X = ((eng.globalTime * 0.2 + eng.width * 0.5) % (eng.width + 200)) - 100;
      var shim2Grad = ctx.createRadialGradient(shimmer2X, eng.height * 0.92, 0, shimmer2X, eng.height * 0.92, 40);
      shim2Grad.addColorStop(0, 'rgba(190,215,245,' + (c.puddleOpacity * 0.2).toFixed(4) + ')');
      shim2Grad.addColorStop(0.6, 'rgba(180,205,235,' + (c.puddleOpacity * 0.06).toFixed(4) + ')');
      shim2Grad.addColorStop(1, 'rgba(170,195,225,0)');
      ctx.fillStyle = shim2Grad;
      ctx.fillRect(0, eng.height * 0.88, eng.width, eng.height * 0.12);
    }
  }
  if (c.veilOpacity > 0) {
    var veilGrad = ctx.createLinearGradient(0, 0, 0, eng.height);
    veilGrad.addColorStop(0, 'rgba(140,170,200,' + (c.veilOpacity * 0.3).toFixed(4) + ')');
    veilGrad.addColorStop(0.5, 'rgba(140,170,200,' + c.veilOpacity.toFixed(4) + ')');
    veilGrad.addColorStop(1, 'rgba(140,170,200,' + (c.veilOpacity * 0.5).toFixed(4) + ')');
    ctx.fillStyle = veilGrad;
    ctx.fillRect(0, 0, eng.width, eng.height);
  }
  if (c.mistOpacity > 0) {
    var mistGrad = ctx.createLinearGradient(0, eng.height * 0.65, 0, eng.height);
    mistGrad.addColorStop(0, 'rgba(160,190,220,0)');
    mistGrad.addColorStop(0.5, 'rgba(160,190,220,' + (c.mistOpacity * 0.3).toFixed(3) + ')');
    mistGrad.addColorStop(1, 'rgba(160,190,220,' + c.mistOpacity.toFixed(3) + ')');
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, eng.height * 0.65, eng.width, eng.height * 0.35);
  }
};

ParticleEngine.drawSnowflakeShape = function(ctx, x, y, size, opacity, rotation, sparkle, depthLayer, shapeType) {
  var r = 255, g = 255, b = 255;
  if (depthLayer < 0.3) {
    r = 230; g = 240; b = 255;
  } else if (depthLayer > 0.7) {
    r = 255; g = 250; b = 240;
  }
  if (size < 2.5) {
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    if (sparkle > 0.1) {
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + Math.min(1, opacity + sparkle * 0.4).toFixed(3) + ')';
    } else {
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + opacity.toFixed(3) + ')';
    }
    ctx.fill();
    if (sparkle > 0.3) {
      ctx.beginPath();
      ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (sparkle * 0.15).toFixed(3) + ')';
      ctx.fill();
    }
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  var finalOpacity = Math.min(1, opacity + sparkle * 0.3);
  ctx.globalAlpha = finalOpacity;
  if (size >= 4 || sparkle > 0.2) {
    ctx.shadowBlur = size * (0.5 + sparkle * 1.5);
    var glowR = r, glowG = g, glowB = b;
    if (depthLayer < 0.3) {
      glowR = 220; glowG = 235; glowB = 255;
    }
    ctx.shadowColor = 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',' + (0.2 + sparkle * 0.4).toFixed(3) + ')';
  }
  ctx.strokeStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  ctx.lineWidth = Math.max(0.3, size * 0.12);
  ctx.lineCap = 'round';
  if (shapeType === 0) {
    ParticleEngine.drawSimpleStar(ctx, size, r, g, b);
  } else if (shapeType === 1) {
    ParticleEngine.drawHexStar(ctx, size, r, g, b);
  } else if (shapeType === 2) {
    ParticleEngine.drawFernStar(ctx, size, r, g, b);
  } else {
    ParticleEngine.drawPlateStar(ctx, size, r, g, b);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();
};

ParticleEngine.drawSimpleStar = function(ctx, size, r, g, b) {
  var armLen = size * 0.9;
  var branchLen = armLen * 0.35;
  for (var i = 0; i < 6; i++) {
    var angle = (Math.PI / 3) * i;
    var ax = Math.cos(angle) * armLen;
    var ay = Math.sin(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    if (size > 3.5) {
      var bx1 = Math.cos(angle + 0.5) * branchLen;
      var by1 = Math.sin(angle + 0.5) * branchLen;
      var bx2 = Math.cos(angle - 0.5) * branchLen;
      var by2 = Math.sin(angle - 0.5) * branchLen;
      var mid = 0.55;
      ctx.beginPath();
      ctx.moveTo(ax * mid, ay * mid);
      ctx.lineTo(ax * mid + bx1, ay * mid + by1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax * mid, ay * mid);
      ctx.lineTo(ax * mid + bx2, ay * mid + by2);
      ctx.stroke();
      if (size > 4.2) {
        var subBranch = branchLen * 0.5;
        var subMid = 0.75;
        var sbx1 = Math.cos(angle + 0.4) * subBranch;
        var sby1 = Math.sin(angle + 0.4) * subBranch;
        var sbx2 = Math.cos(angle - 0.4) * subBranch;
        var sby2 = Math.sin(angle - 0.4) * subBranch;
        ctx.beginPath();
        ctx.moveTo(ax * subMid, ay * subMid);
        ctx.lineTo(ax * subMid + sbx1, ay * subMid + sby1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax * subMid, ay * subMid);
        ctx.lineTo(ax * subMid + sbx2, ay * subMid + sby2);
        ctx.stroke();
      }
    }
    if (size > 4.5) {
      var tipDot = size * 0.06;
      ctx.beginPath();
      ctx.arc(ax, ay, tipDot, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  ctx.fill();
};

ParticleEngine.drawHexStar = function(ctx, size, r, g, b) {
  var armLen = size * 0.85;
  var branchLen = armLen * 0.4;
  for (var i = 0; i < 6; i++) {
    var angle = (Math.PI / 3) * i;
    var ax = Math.cos(angle) * armLen;
    var ay = Math.sin(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    var mid1 = 0.35;
    var mid2 = 0.65;
    var bx1 = Math.cos(angle + 0.55) * branchLen;
    var by1 = Math.sin(angle + 0.55) * branchLen;
    var bx2 = Math.cos(angle - 0.55) * branchLen;
    var by2 = Math.sin(angle - 0.55) * branchLen;
    ctx.beginPath();
    ctx.moveTo(ax * mid1, ay * mid1);
    ctx.lineTo(ax * mid1 + bx1, ay * mid1 + by1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax * mid1, ay * mid1);
    ctx.lineTo(ax * mid1 + bx2, ay * mid1 + by2);
    ctx.stroke();
    if (size > 4) {
      ctx.beginPath();
      ctx.moveTo(ax * mid2, ay * mid2);
      ctx.lineTo(ax * mid2 + bx1 * 0.7, ay * mid2 + by1 * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax * mid2, ay * mid2);
      ctx.lineTo(ax * mid2 + bx2 * 0.7, ay * mid2 + by2 * 0.7);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(ax, ay, size * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  ctx.fill();
};

ParticleEngine.drawFernStar = function(ctx, size, r, g, b) {
  var armLen = size * 0.9;
  for (var i = 0; i < 6; i++) {
    var angle = (Math.PI / 3) * i;
    var ax = Math.cos(angle) * armLen;
    var ay = Math.sin(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    var branchPositions = [0.3, 0.5, 0.7];
    for (var bp = 0; bp < branchPositions.length; bp++) {
      var pos = branchPositions[bp];
      var bLen = armLen * 0.25 * (1 - pos * 0.5);
      var bx1 = Math.cos(angle + 0.5) * bLen;
      var by1 = Math.sin(angle + 0.5) * bLen;
      var bx2 = Math.cos(angle - 0.5) * bLen;
      var by2 = Math.sin(angle - 0.5) * bLen;
      ctx.beginPath();
      ctx.moveTo(ax * pos, ay * pos);
      ctx.lineTo(ax * pos + bx1, ay * pos + by1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax * pos, ay * pos);
      ctx.lineTo(ax * pos + bx2, ay * pos + by2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(ax, ay, size * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  ctx.fill();
};

ParticleEngine.drawPlateStar = function(ctx, size, r, g, b) {
  var armLen = size * 0.7;
  var plateR = size * 0.45;
  ctx.beginPath();
  ctx.arc(0, 0, plateR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.4)';
  ctx.lineWidth = Math.max(0.2, size * 0.06);
  ctx.stroke();
  for (var i = 0; i < 6; i++) {
    var angle = (Math.PI / 3) * i;
    var sx = Math.cos(angle) * plateR;
    var sy = Math.sin(angle) * plateR;
    var ex = Math.cos(angle) * armLen;
    var ey = Math.sin(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.lineWidth = Math.max(0.3, size * 0.12);
    ctx.stroke();
    if (size > 4) {
      var tipLen = armLen * 0.2;
      var tx1 = Math.cos(angle + 0.4) * tipLen;
      var ty1 = Math.sin(angle + 0.4) * tipLen;
      var tx2 = Math.cos(angle - 0.4) * tipLen;
      var ty2 = Math.sin(angle - 0.4) * tipLen;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + tx1, ey + ty1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + tx2, ey + ty2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  ctx.fill();
};

ParticleEngine.drawSnow = function(eng) {
  var ctx = eng.ctx;
  var c = eng.config;
  var i, f, sparkle;
  for (i = 0; i < eng.bgParticles.length; i++) {
    f = eng.bgParticles[i];
    sparkle = Math.max(0, Math.sin(f.sparklePhase) - 0.92) * 8;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.size * 1.3, 0, Math.PI * 2);
    var bgOp = f.opacity * 0.35;
    if (sparkle > 0.1) bgOp = Math.min(1, bgOp + sparkle * 0.08);
    var bgR = 255, bgG = 255, bgB = 255;
    if (f.depthLayer < 0.3) { bgR = 230; bgG = 240; bgB = 255; }
    else if (f.depthLayer > 0.7) { bgR = 255; bgG = 250; bgB = 240; }
    ctx.fillStyle = 'rgba(' + bgR + ',' + bgG + ',' + bgB + ',' + bgOp.toFixed(3) + ')';
    ctx.fill();
  }
  for (i = 0; i < eng.particles.length; i++) {
    f = eng.particles[i];
    sparkle = Math.max(0, Math.sin(f.sparklePhase) - 0.92) * 8;
    ParticleEngine.drawSnowflakeShape(ctx, f.x, f.y, f.size, f.opacity, f.rotation, sparkle, f.depthLayer, f.shapeType);
  }
  var snowGrad = ctx.createLinearGradient(0, eng.height * 0.82, 0, eng.height);
  snowGrad.addColorStop(0, 'rgba(220,230,245,0)');
  var groundOp = c.groundOpacity || 0;
  if (groundOp > 0) {
    snowGrad.addColorStop(0.3, 'rgba(225,235,248,' + (groundOp * 0.3).toFixed(4) + ')');
    snowGrad.addColorStop(0.55, 'rgba(230,240,250,' + (groundOp * 0.55).toFixed(4) + ')');
    snowGrad.addColorStop(0.8, 'rgba(235,242,252,' + (groundOp * 0.8).toFixed(4) + ')');
    snowGrad.addColorStop(1, 'rgba(240,245,253,' + groundOp.toFixed(4) + ')');
  } else {
    snowGrad.addColorStop(0.5, 'rgba(225,235,248,0.02)');
    snowGrad.addColorStop(1, 'rgba(230,240,250,0.05)');
  }
  ctx.fillStyle = snowGrad;
  ctx.fillRect(0, eng.height * 0.82, eng.width, eng.height * 0.18);
  if (groundOp > 0.01) {
    var driftPhase = eng.globalTime * 0.0003;
    for (var di = 0; di < 4; di++) {
      var driftX = Math.sin(driftPhase + di * 1.8) * eng.width * 0.12 + eng.width * (0.15 + di * 0.22);
      var driftW = 60 + di * 25;
      var driftH = 5 + di * 2;
      var driftGrad = ctx.createRadialGradient(driftX, eng.height - driftH * 0.5, 0, driftX, eng.height - driftH * 0.5, driftW * 0.5);
      driftGrad.addColorStop(0, 'rgba(240,245,253,' + (groundOp * 0.5).toFixed(4) + ')');
      driftGrad.addColorStop(0.6, 'rgba(235,242,252,' + (groundOp * 0.2).toFixed(4) + ')');
      driftGrad.addColorStop(1, 'rgba(230,240,250,0)');
      ctx.fillStyle = driftGrad;
      ctx.beginPath();
      ctx.ellipse(driftX, eng.height - driftH * 0.5, driftW * 0.5, driftH, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

ParticleEngine.setIntensity = function(eng, intensity) {
  var isRain = eng.type === ParticleEngine.RAIN;
  var configs = isRain ? ParticleEngine.RAIN_CONFIGS : ParticleEngine.SNOW_CONFIGS;
  eng.intensity = intensity;
  eng.config = configs[intensity] || configs.moderate;
  var target = eng.config.count;
  while (eng.particles.length < target) {
    if (isRain) {
      eng.particles.push(ParticleEngine.createRainDrop(eng, true, false));
    } else {
      eng.particles.push(ParticleEngine.createSnowFlake(eng, true, false));
    }
  }
  if (eng.particles.length > target) {
    eng.particles.length = target;
  }
  var bgTarget = eng.config.bgCount || 0;
  while (eng.bgParticles.length < bgTarget) {
    if (isRain) {
      eng.bgParticles.push(ParticleEngine.createRainDrop(eng, true, true));
    } else {
      eng.bgParticles.push(ParticleEngine.createSnowFlake(eng, true, true));
    }
  }
  if (eng.bgParticles.length > bgTarget) {
    eng.bgParticles.length = bgTarget;
  }
};

ParticleEngine.stop = function(eng) {
  eng.running = false;
  if (eng.raf) {
    cancelAnimationFrame(eng.raf);
    eng.raf = null;
  }
  eng.particles = [];
  eng.bgParticles = [];
  eng.splashes = [];
  eng.ripples = [];
  eng.bounceDrops = [];
  if (eng.ctx) {
    eng.ctx.clearRect(0, 0, eng.width, eng.height);
  }
};

ParticleEngine.destroy = function(eng) {
  ParticleEngine.stop(eng);
  eng.canvas = null;
  eng.ctx = null;
};

export default ParticleEngine;
