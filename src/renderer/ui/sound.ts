import { appStore } from '../store/app';

let click: HTMLAudioElement | null = null;

/** Legacy's button click sound, when enabled in settings. Never throws (autoplay, no device). */
export function playClick(): void {
  if (appStore.get().settings?.clickSound === false) return;
  try {
    click ??= new Audio('./sounds/click.mp3');
    click.currentTime = 0;
    void click.play().catch(() => undefined);
  } catch {
    // No audio device or blocked: silence is fine.
  }
}
