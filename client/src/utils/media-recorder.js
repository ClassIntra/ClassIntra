// 媒体录制共享工具函数
// 供 GuestUpload.vue / CloudUpload.vue / RecordModal.vue 复用

// 检测 MediaRecorder 是否受支持
export function isMediaRecorderSupported() {
  return typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
}

// 选择支持的 MIME 类型，kind: 'audio' / 'video'
export function pickMimeTypes(kind) {
  var candidates;
  if (kind === 'video') {
    candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
  } else {
    candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg'
    ];
  }
  for (var i = 0; i < candidates.length; i++) {
    if (window.MediaRecorder.isTypeSupported(candidates[i])) {
      return candidates[i];
    }
  }
  return '';
}

// 从 MIME 获取扩展名
// kind: 'audio'/'video' 用于区分歧义 MIME（audio/mp4 应为 .m4a，避免被云盘识别为视频）
export function extFromMime(mime, kind) {
  if (!mime) return '.bin';
  if (mime.indexOf('webm') > -1) return '.webm';
  // audio/mp4 使用 .m4a 扩展名，避免被云盘识别为视频
  if (kind === 'audio' && mime.indexOf('mp4') > -1) return '.m4a';
  if (mime.indexOf('mp4') > -1) return '.mp4';
  if (mime.indexOf('ogg') > -1) return '.ogg';
  if (mime.indexOf('mp3') > -1) return '.mp3';
  if (mime.indexOf('wav') > -1) return '.wav';
  return '.bin';
}

// 从文件名获取媒体类型：'image' / 'video' / 'audio' / 'other'
export function getMediaTypeByName(name) {
  var ext = '';
  var idx = name.lastIndexOf('.');
  if (idx > -1) ext = name.substring(idx).toLowerCase();
  var imgs = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  var vids = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
  var auds = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];
  if (imgs.indexOf(ext) > -1) return 'image';
  if (vids.indexOf(ext) > -1) return 'video';
  if (auds.indexOf(ext) > -1) return 'audio';
  return 'other';
}

// 获取友好的媒体设备错误信息
export function getMediaError(err) {
  if (!err) return '设备访问失败';
  var name = err.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '已拒绝访问设备权限，请在浏览器设置中允许';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '未找到摄像头或麦克风设备';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '设备被其他程序占用';
  }
  if (name === 'OverconstrainedError') {
    return '设备不满足要求，尝试切换摄像头';
  }
  return err.message || '设备访问失败';
}

// 录音专用 audio constraints（降噪/回声消除/单声道/48kHz）
export function getAudioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000
  };
}

// 录像专用 audio constraints（降噪/回声消除，保持双声道）
export function getVideoAudioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
}
