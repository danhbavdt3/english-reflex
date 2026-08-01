(() => {
  "use strict";
  const data = window.ENGLISH_REFLEX_DATA;
  if (!data?.lessons?.length) {
    document.body.innerHTML = "<p style='padding:20px'>Không tìm thấy dữ liệu bài học.</p>";
    return;
  }

  const el = Object.fromEntries([
    "lessonSelect","questionText","questionMeaningText","answerText","answerMeaningText",
    "voiceText","progressText","phaseText","countdown","playButton",
    "repeatButton","prevButton","nextButton","loopLesson","showMeaning","statusMessage","installButton"
  ].map(id => [id, document.getElementById(id)]));
  el.speedButtons = [...document.querySelectorAll(".speed-button")];

  let lessonIndex = 0;
  let itemIndex = Number(localStorage.getItem("englishReflex.v16.itemIndex") || 0);
  let playbackSpeed = Number(localStorage.getItem("englishReflex.v16.playbackSpeed") || 1);
  let isRunning = false;
  let runToken = 0;
  let deferredInstallPrompt = null;
  let voices = [];
  const variantIndexes = new Map();

  const lesson = () => data.lessons[lessonIndex];
  const baseItem = () => lesson().items[itemIndex];

  function resolvedItem() {
    const item = baseItem();
    if (!item.variants?.length) return item;
    const variantIndex = variantIndexes.get(itemIndex) || 0;
    return { ...item, ...item.variants[variantIndex], variantIndex };
  }

  function advanceVariant() {
    const item = baseItem();
    if (!item.variants?.length) return;
    const current = variantIndexes.get(itemIndex) || 0;
    variantIndexes.set(itemIndex, (current + 1) % item.variants.length);
  }

  function clampIndex() {
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= lesson().items.length) itemIndex = 0;
  }

  function updateScreen() {
    clampIndex();
    const item = resolvedItem();
    el.questionText.textContent = item.question;
    el.answerText.textContent = item.answer;
    el.questionMeaningText.textContent = el.showMeaning.checked ? item.questionMeaning || "" : "";
    el.answerMeaningText.textContent = el.showMeaning.checked ? item.answerMeaning || "" : "";
    el.progressText.textContent = `Câu ${itemIndex + 1}/${lesson().items.length}`;
    localStorage.setItem("englishReflex.v16.itemIndex", String(itemIndex));
  }

  const setPhase = text => { el.phaseText.textContent = text; };
  const setCountdown = text => { el.countdown.textContent = text; };

  function updatePlayButton() {
    el.playButton.firstChild.textContent = isRunning ? "■" : "▶";
    el.playButton.querySelector("span").textContent = isRunning ? "Dừng" : "Phát";
  }

  function stopAll() {
    runToken += 1;
    isRunning = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    updatePlayButton();
  }

  function wait(ms, token) {
    return new Promise(resolve => {
      const started = performance.now();
      const tick = () => {
        if (token !== runToken) return resolve(false);
        const remain = Math.max(0, ms - (performance.now() - started));
        if (ms >= 1500) setCountdown(`Nhại theo · ${Math.ceil(remain / 1000)} giây`);
        if (remain <= 0) return resolve(true);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function loadVoices() { voices = window.speechSynthesis?.getVoices() || []; }
  function chooseVoice(language) {
    const preferred = ["Samantha", "Ava", "Karen", "Moira", "Daniel", "Alex"];
    const matching = voices.filter(v => v.lang?.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()));
    return preferred.map(name => matching.find(v => v.name.includes(name))).find(Boolean)
      || matching.find(v => v.localService) || matching[0] || null;
  }

  function speakText(text, token) {
    return new Promise(resolve => {
      if (!window.speechSynthesis || token !== runToken) return resolve(false);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = data.settings.language || "en-US";
      utterance.rate = Number(data.settings.speechRate || 0.84) * playbackSpeed;
      utterance.pitch = Number(data.settings.speechPitch || 1);
      const voice = chooseVoice(utterance.lang);
      if (voice) utterance.voice = voice;
      el.voiceText.textContent = voice ? `Giọng hệ thống · ${voice.name}` : "Giọng hệ thống";
      let finished = false;
      const finish = ok => { if (!finished) { finished = true; resolve(ok && token === runToken); } };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      setTimeout(() => {
        if (token !== runToken) return finish(false);
        window.speechSynthesis.speak(utterance);
      }, 80);
    });
  }

  async function playCurrentSequence() {
    stopAll();
    const token = runToken;
    isRunning = true;
    updatePlayButton();
    el.statusMessage.textContent = "";

    while (isRunning && token === runToken) {
      const item = resolvedItem();
      updateScreen();

      const repeats = Math.max(1, Number(data.settings.answerRepeats || 3));
      let ok = true;
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        setPhase(`Nghe câu hỏi ${repeat}/${repeats}`);
        setCountdown("Nghe câu hỏi");
        if (!(await speakText(item.questionSpeech || item.question, token))) { ok = false; break; }
        if (!(await wait(Number(data.settings.pauseAfterQuestionMs || 700), token))) { ok = false; break; }

        setPhase(`Nghe câu trả lời ${repeat}/${repeats}`);
        setCountdown("Nghe đúng âm rồi nhại theo");
        if (!(await speakText(item.answerSpeech || item.answer, token))) { ok = false; break; }
        if (!(await wait(Number(data.settings.pauseForImitationMs || 2400), token))) { ok = false; break; }
      }
      if (!ok || token !== runToken || !isRunning) break;

      advanceVariant();
      if (!(await wait(Number(data.settings.pauseBetweenItemsMs || 900), token))) break;
      if (itemIndex < lesson().items.length - 1) itemIndex += 1;
      else if (el.loopLesson.checked) itemIndex = 0;
      else { isRunning = false; setPhase("Hoàn thành"); setCountdown("Đã học hết bài"); break; }
    }
    if (token === runToken) { isRunning = false; updatePlayButton(); updateScreen(); }
  }

  function moveItem(step) {
    stopAll();
    itemIndex = (itemIndex + step + lesson().items.length) % lesson().items.length;
    updateScreen(); setPhase("Sẵn sàng"); setCountdown("Bấm Phát để bắt đầu");
  }

  function applySpeedSelection(speed) {
    playbackSpeed = Number(speed);
    localStorage.setItem("englishReflex.v16.playbackSpeed", String(playbackSpeed));
    el.speedButtons.forEach(b => b.classList.toggle("active", Number(b.dataset.speed) === playbackSpeed));
    window.speechSynthesis?.cancel();
  }

  data.lessons.forEach((item, index) => {
    const option = document.createElement("option"); option.value = index; option.textContent = item.title;
    el.lessonSelect.appendChild(option);
  });
  el.lessonSelect.addEventListener("change", () => { stopAll(); lessonIndex = Number(el.lessonSelect.value); itemIndex = 0; updateScreen(); });
  el.playButton.addEventListener("click", () => isRunning ? (stopAll(), setPhase("Đã dừng"), setCountdown("Bấm Phát để nghe lại từ đầu câu")) : playCurrentSequence());
  el.repeatButton.addEventListener("click", playCurrentSequence);
  el.prevButton.addEventListener("click", () => moveItem(-1));
  el.nextButton.addEventListener("click", () => moveItem(1));
  el.showMeaning.addEventListener("change", updateScreen);
  el.speedButtons.forEach(button => button.addEventListener("click", () => applySpeedSelection(button.dataset.speed)));
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; el.installButton.classList.remove("hidden"); });
  el.installButton.addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; el.installButton.classList.add("hidden"); });
  window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
  loadVoices(); applySpeedSelection(playbackSpeed); updateScreen(); setPhase("Sẵn sàng"); setCountdown("Bấm Phát để bắt đầu");

  const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (localHost && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(reg => reg.unregister())));
    window.caches?.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register(`service-worker.js?v=${data.version}`, { updateViaCache: "none" }));
  }
})();
