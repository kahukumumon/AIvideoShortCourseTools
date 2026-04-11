import type { MediaKind, MediaSourceItem } from '../types';

function loadMetadataFromElement<T extends HTMLMediaElement>(element: T, file: File, kind: MediaKind) {
  return new Promise<MediaSourceItem>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve({
        id: crypto.randomUUID(),
        kind,
        name: file.name,
        file,
        objectUrl,
        duration: Number.isFinite(element.duration) ? element.duration : 0,
        width: element instanceof HTMLVideoElement ? element.videoWidth : undefined,
        height: element instanceof HTMLVideoElement ? element.videoHeight : undefined,
      });
    };
    const onError = () => {
      cleanup();
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`${kind === 'video' ? '動画' : '音声'}の読み込みに失敗しました。`));
    };
    element.preload = 'metadata';
    element.src = objectUrl;
    element.addEventListener('loadedmetadata', onLoaded, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

export function loadVideoSource(file: File) {
  return loadMetadataFromElement(document.createElement('video'), file, 'video');
}

export function loadAudioSource(file: File) {
  return loadMetadataFromElement(document.createElement('audio'), file, 'audio');
}
