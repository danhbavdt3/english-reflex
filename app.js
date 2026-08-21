(() => {
  "use strict";
  const data = window.ENGLISH_REFLEX_DATA;
  if (!data?.lessons?.length) {
    document.body.innerHTML = "<p style='padding:20px'>Không tìm thấy dữ liệu bài học.</p>";
    return;
  }

  const STORAGE = "englishReflex.v19";
  const el = Object.fromEntries([
    "lessonSelect","questionText","questionMeaningText","answerText","answerMeaningText",
    "voiceText","progressText","phaseText","countdown","playButton",
    "repeatButton","prevButton","nextButton","loopLesson","showMeaning","statusMessage","installButton",
    "practiceModeButton","testModeButton","revealAnswerButton","answerBlock","answerDivider"
  ].map(id => [id, document.getElementById(id)]));
  el.speedButtons = [...document.querySelectorAll(".speed-button")];

  let lessonIndex = Number(localStorage.getItem(`${STORAGE}.lessonIndex`) || 0);
  let itemIndex = Number(localStorage.getItem(`${STORAGE}.itemIndex`) || 0);
  let playbackSpeed = Number(localStorage.getItem(`${STORAGE}.playbackSpeed`) || 1);
  let mode = localStorage.getItem(`${STORAGE}.mode`) === "test" ? "test" : "practice";
  let answerRevealed = false;
  let testCountdownFinished = false;
  let isRunning = false;
  let runToken = 0;
  let deferredInstallPrompt = null;
  let voices = [];
  const variantIndexes = new Map();

  const lesson = () => data.lessons[lessonIndex];
  const baseItem = () => lesson().items[itemIndex];
  const variantKey = () => `${lesson().id}:${itemIndex}`;

  function resolvedItem() {
    const item = baseItem();
    if (!item.variants?.length) return item;
    const variantIndex = variantIndexes.get(variantKey()) || 0;
    return { ...item, ...item.variants[variantIndex], variantIndex };
  }

  function advanceVariant() {
    const item = baseItem();
    if (!item.variants?.length) return;
    const key = variantKey();
    const current = variantIndexes.get(key) || 0;
    variantIndexes.set(key, (current + 1) % item.variants.length);
  }

  function clampIndexes() {
    if (!Number.isInteger(lessonIndex) || lessonIndex < 0 || lessonIndex >= data.lessons.length) lessonIndex = 0;
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= lesson().items.length) itemIndex = 0;
  }

  function updateScreen() {
    clampIndexes();
    const item = resolvedItem();
    el.lessonSelect.value = String(lessonIndex);
    el.questionText.textContent = item.question;
    el.answerText.textContent = item.answer;
    el.questionMeaningText.textContent = el.showMeaning.checked ? item.questionMeaning || "" : "";
    el.answerMeaningText.textContent = el.showMeaning.checked ? item.answerMeaning || "" : "";
    el.progressText.textContent = `Câu ${itemIndex + 1}/${lesson().items.length}`;
    localStorage.setItem(`${STORAGE}.lessonIndex`, String(lessonIndex));
    localStorage.setItem(`${STORAGE}.itemIndex`, String(itemIndex));
    updateModeScreen();
  }

  function updateModeScreen() {
    const isTest = mode === "test";
    el.practiceModeButton.classList.toggle("active", !isTest);
    el.testModeButton.classList.toggle("active", isTest);
    el.repeatButton.classList.toggle("hidden", isTest);
    el.loopLesson.closest("label").classList.toggle("hidden", isTest);
    el.revealAnswerButton.classList.toggle("hidden", !isTest || answerRevealed || !testCountdownFinished);
    el.answerBlock.classList.toggle("hidden", isTest && !answerRevealed);
    el.answerDivider.classList.toggle("hidden", isTest && !answerRevealed);
  }

  function setMode(nextMode) {
    stopAll();
    mode = nextMode;
    answerRevealed = mode !== "test";
    testCountdownFinished = false;
    localStorage.setItem(`${STORAGE}.mode`, mode);
    updateScreen();
    setPhase("Sẵn sàng");
    setCountdown(mode === "test" ? "Bấm Phát để bắt đầu kiểm tra" : "Bấm Phát để bắt đầu");
  }

  async function revealAnswer() {
    answerRevealed = true;
    updateModeScreen();
    setPhase("Nghe câu trả lời");
    setCountdown("Nghe câu trả lời mẫu");
    const token = runToken;
    const item = resolvedItem();
    await speakText(item.answerSpeech || item.answer, token, data.settings.language);
    if (token !== runToken) return;
    setPhase("Nghe nghĩa câu trả lời");
    setCountdown("Nghe nghĩa tiếng Việt");
    await speakText(item.answerMeaning, token, data.settings.meaningLanguage, true);
    if (token === runToken) {
      setPhase("Đã hiện câu trả lời");
      setCountdown("Tự đối chiếu câu vừa nói");
    }
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

  function wait(ms, token, label) {
    return new Promise(resolve => {
      const started = performance.now();
      const tick = () => {
        if (token !== runToken) return resolve(false);
        const remain = Math.max(0, ms - (performance.now() - started));
        if (ms >= 1000) setCountdown(`${label} · ${Math.ceil(remain / 1000)} giây`);
        if (remain <= 0) return resolve(true);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function loadVoices() { voices = window.speechSynthesis?.getVoices() || []; }

  function chooseVoice(language) {
    const code = language.slice(0, 2).toLowerCase();
    const preferredEnglish = ["Samantha", "Ava", "Karen", "Moira", "Daniel", "Alex"];
    const preferredVietnamese = ["Linh", "An", "Vietnamese"];
    const preferred = code === "vi" ? preferredVietnamese : preferredEnglish;
    const matching = voices.filter(v => v.lang?.toLowerCase().startsWith(code));
    return preferred.map(name => matching.find(v => v.name.includes(name))).find(Boolean)
      || matching.find(v => v.localService) || matching[0] || null;
  }

  function speakText(text, token, language = data.settings.language, isMeaning = false) {
    return new Promise(resolve => {
      if (!text) return resolve(true);
      if (!window.speechSynthesis || token !== runToken) return resolve(false);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      const baseRate = isMeaning ? Number(data.settings.meaningSpeechRate || 0.92) : Number(data.settings.speechRate || 0.84);
      utterance.rate = baseRate * playbackSpeed;
      utterance.pitch = Number(data.settings.speechPitch || 1);
      const voice = chooseVoice(language);
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

  async function playTestQuestion() {
    stopAll();
    const token = runToken;
    isRunning = true;
    answerRevealed = false;
    testCountdownFinished = false;
    updateScreen();
    updatePlayButton();
    el.statusMessage.textContent = "";
    const item = resolvedItem();

    setPhase("Nghe câu hỏi");
    setCountdown("Nghe câu hỏi");
    if (!(await speakText(item.questionSpeech || item.question, token, data.settings.language))) return finishRun(token);

    if (lesson().practiceType === "question-reflex") {
      setPhase("Nghe nghĩa câu hỏi");
      setCountdown("Nghe nghĩa tiếng Việt");
      if (!(await speakText(item.questionMeaning, token, data.settings.meaningLanguage, true))) return finishRun(token);
    }

    setPhase("Bạn trả lời");
    await wait(5000, token, "Bạn trả lời");
    if (token === runToken) {
      testCountdownFinished = true;
      updateModeScreen();
      setPhase("Hết 5 giây");
      setCountdown("Bấm Xem câu trả lời để đối chiếu");
    }
    finishRun(token);
  }

  function finishRun(token) {
    if (token === runToken) {
      isRunning = false;
      updatePlayButton();
    }
  }

  async function playLessonOneItem(item, token) {
    const repeats = Math.max(1, Number(data.settings.answerRepeats || 3));
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      setPhase(`Nghe câu hỏi ${repeat}/${repeats}`);
      setCountdown("Nghe câu hỏi");
      if (!(await speakText(item.questionSpeech || item.question, token, data.settings.language))) return false;

      setPhase(`Bạn trả lời ${repeat}/${repeats}`);
      if (!(await wait(Number(data.settings.pauseAfterQuestionMs || 3500), token, "Bạn trả lời"))) return false;

      setPhase(`Nghe câu trả lời ${repeat}/${repeats}`);
      setCountdown("Nghe đúng âm rồi nhại theo");
      if (!(await speakText(item.answerSpeech || item.answer, token, data.settings.language))) return false;

      setPhase(`Bạn nhại theo ${repeat}/${repeats}`);
      if (!(await wait(Number(data.settings.pauseForImitationMs || 3000), token, "Bạn nhại theo"))) return false;
    }
    return true;
  }

  async function playQuestionReflexItem(item, token) {
    setPhase("Nghe câu hỏi");
    setCountdown("Nghe câu hỏi tiếng Anh");
    if (!(await speakText(item.questionSpeech || item.question, token, data.settings.language))) return false;

    setPhase("Nghe nghĩa câu hỏi");
    setCountdown("Nghe nghĩa tiếng Việt");
    if (!(await speakText(item.questionMeaning, token, data.settings.meaningLanguage, true))) return false;

    setPhase("Bạn tự bật câu hỏi");
    if (!(await wait(4000, token, "Bạn tự nói câu hỏi"))) return false;

    setPhase("Nghe lại câu hỏi");
    setCountdown("Nghe câu hỏi chuẩn");
    if (!(await speakText(item.questionSpeech || item.question, token, data.settings.language))) return false;

    setPhase("Bạn nhại câu hỏi");
    if (!(await wait(3000, token, "Bạn nhại câu hỏi"))) return false;

    setPhase("Nghe câu trả lời");
    setCountdown("Nghe câu trả lời mẫu");
    if (!(await speakText(item.answerSpeech || item.answer, token, data.settings.language))) return false;

    setPhase("Nghe nghĩa câu trả lời");
    setCountdown("Nghe nghĩa tiếng Việt");
    if (!(await speakText(item.answerMeaning, token, data.settings.meaningLanguage, true))) return false;

    setPhase("Bạn nhại câu trả lời");
    return wait(3000, token, "Bạn nhại câu trả lời");
  }

  async function playCurrentSequence() {
    if (mode === "test") return playTestQuestion();
    stopAll();
    const token = runToken;
    isRunning = true;
    updatePlayButton();
    el.statusMessage.textContent = "";

    while (isRunning && token === runToken) {
      const item = resolvedItem();
      updateScreen();
      const ok = lesson().practiceType === "question-reflex"
        ? await playQuestionReflexItem(item, token)
        : await playLessonOneItem(item, token);
      if (!ok || token !== runToken || !isRunning) break;

      advanceVariant();
      if (!(await wait(Number(data.settings.pauseBetweenItemsMs || 900), token, "Chuyển câu"))) break;
      if (itemIndex < lesson().items.length - 1) itemIndex += 1;
      else if (el.loopLesson.checked) itemIndex = 0;
      else {
        isRunning = false;
        setPhase("Hoàn thành");
        setCountdown("Đã học hết bài");
        break;
      }
    }
    if (token === runToken) {
      isRunning = false;
      updatePlayButton();
      updateScreen();
    }
  }

  function moveItem(step) {
    stopAll();
    itemIndex = (itemIndex + step + lesson().items.length) % lesson().items.length;
    answerRevealed = mode !== "test";
    testCountdownFinished = false;
    updateScreen();
    setPhase("Sẵn sàng");
    setCountdown("Bấm Phát để bắt đầu");
  }

  function applySpeedSelection(speed) {
    playbackSpeed = Number(speed);
    localStorage.setItem(`${STORAGE}.playbackSpeed`, String(playbackSpeed));
    el.speedButtons.forEach(b => b.classList.toggle("active", Number(b.dataset.speed) === playbackSpeed));
    window.speechSynthesis?.cancel();
  }

  data.lessons.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = item.title;
    el.lessonSelect.appendChild(option);
  });

  clampIndexes();
  el.lessonSelect.value = String(lessonIndex);
  el.lessonSelect.addEventListener("change", () => {
    stopAll();
    lessonIndex = Number(el.lessonSelect.value);
    itemIndex = 0;
    answerRevealed = mode !== "test";
    testCountdownFinished = false;
    updateScreen();
    setPhase("Sẵn sàng");
    setCountdown("Bấm Phát để bắt đầu");
  });
  el.playButton.addEventListener("click", () => isRunning
    ? (stopAll(), setPhase("Đã dừng"), setCountdown("Bấm Phát để nghe lại từ đầu câu"))
    : playCurrentSequence());
  el.repeatButton.addEventListener("click", playCurrentSequence);
  el.practiceModeButton.addEventListener("click", () => setMode("practice"));
  el.testModeButton.addEventListener("click", () => setMode("test"));
  el.revealAnswerButton.addEventListener("click", revealAnswer);
  el.prevButton.addEventListener("click", () => moveItem(-1));
  el.nextButton.addEventListener("click", () => moveItem(1));
  el.showMeaning.addEventListener("change", updateScreen);
  el.speedButtons.forEach(button => button.addEventListener("click", () => applySpeedSelection(button.dataset.speed)));
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    el.installButton.classList.remove("hidden");
  });
  el.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    el.installButton.classList.add("hidden");
  });
  window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
  loadVoices();
  applySpeedSelection(playbackSpeed);
  answerRevealed = mode !== "test";
  updateScreen();
  setPhase("Sẵn sàng");
  setCountdown(mode === "test" ? "Bấm Phát để bắt đầu kiểm tra" : "Bấm Phát để bắt đầu");

  const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (localHost && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(reg => reg.unregister())));
    window.caches?.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register(`service-worker.js?v=${data.version}`, { updateViaCache: "none" }));
  }
})();
