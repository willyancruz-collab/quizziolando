let audioContext;
let enabled = false;
let button;

const SOUND_KEY = "quizziolando:sound-enabled";
const isStoredEnabled = () => {
  try {
    return sessionStorage.getItem(SOUND_KEY) === "true";
  } catch (error) {
    console.warn("Não foi possível ler a preferência de som.", error);
    return false;
  }
};

function playTone(kind = "click") {
  if (!enabled || !audioContext) return;
  const tones = {
    click: [520, 0.045, "sine"],
    success: [740, 0.14, "sine"],
    error: [220, 0.16, "triangle"],
    reward: [880, 0.2, "sine"]
  };
  const [frequency, duration, wave] = tones[kind] || tones.click;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (kind === "success" || kind === "reward") {
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.25, now + duration);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

export function playSiteSound(kind) {
  playTone(kind);
}

export function setupSoundEffects() {
  if (button || !document.body) return;
  enabled = isStoredEnabled();
  button = document.createElement("button");
  button.type = "button";
  button.className = "sound-toggle";
  button.setAttribute("aria-pressed", String(enabled));
  button.setAttribute("aria-label", enabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros");
  button.textContent = enabled ? "🔊 Som" : "🔇 Som";
  button.addEventListener("click", async () => {
    enabled = !enabled;
    try {
      sessionStorage.setItem(SOUND_KEY, String(enabled));
      if (enabled) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Este navegador não oferece suporte a áudio.");
        audioContext ||= new AudioContextClass();
        await audioContext.resume();
      }
    } catch (error) {
      enabled = false;
      console.error("Não foi possível ativar os efeitos sonoros.", error);
    }
    button.textContent = enabled ? "🔊 Som" : "🔇 Som";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros");
    if (enabled) playTone("success");
  });
  document.body.append(button);
  document.addEventListener("click", async (event) => {
    if (event.target.closest(".sound-toggle")) return;
    const control = event.target.closest("button, a");
    if (!control || control.matches(":disabled, [aria-disabled='true']") || !enabled) return;
    try {
      if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Este navegador não oferece suporte a áudio.");
        audioContext = new AudioContextClass();
      }
      await audioContext.resume();
      playTone("click");
    } catch (error) {
      enabled = false;
      button.textContent = "🔇 Som";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Ativar efeitos sonoros");
      console.error("Não foi possível reproduzir os efeitos sonoros.", error);
    }
  });
}
