(() => {
  const form = document.querySelector("#chat-form");
  const input = document.querySelector("#message-input");
  const sendButton = document.querySelector("#send-button");
  const messageList = document.querySelector("#message-list");
  const welcome = document.querySelector("#welcome");
  const imageInput = document.querySelector("#image-input");
  const imagePreview = document.querySelector("#image-preview");
  const attachmentPreview = document.querySelector("#attachment-preview");
  const attachmentName = document.querySelector("#attachment-name");
  const voiceButton = document.querySelector("#voice-button");
  const voiceStatus = document.querySelector("#voice-status");
  const toast = document.querySelector("#toast");
  const statusText = document.querySelector("#status-text");
  const statusDot = document.querySelector("#status-dot");
  const profileStatus = document.querySelector(".online-dot");
  const sidebar = document.querySelector("#sidebar");
  const menuToggle = document.querySelector("#menu-toggle");
  const aboutModal = document.querySelector("#about-modal");
  const newChatButton = document.querySelector("#new-chat");

  let selectedImage = null;
  let conversationId = null;
  let history = [];
  let isSending = false;
  let recorder = null;
  let audioChunks = [];
  let toastTimer = null;

  const icon = {
    copy: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H7" stroke="currentColor" stroke-width="1.4"/></svg>',
    speak: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 7a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    external: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 3H3.8A1.8 1.8 0 0 0 2 4.8v7.4A1.8 1.8 0 0 0 3.8 14h7.4a1.8 1.8 0 0 0 1.8-1.8V9.5M8 2h6v6m-.2-5.8L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function updateSendButton() {
    sendButton.disabled = isSending || (!input.value.trim() && !selectedImage);
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    updateSendButton();
  }

  async function checkService() {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("Health check failed");
      const service = await response.json();
      const ready = Boolean(service.configured);
      statusText.textContent = ready ? "Ready to help" : "Setup needed";
      statusDot.classList.toggle("ready", ready);
      statusDot.classList.toggle("offline", !ready);
      profileStatus.classList.toggle("ready", ready);
      profileStatus.classList.toggle("offline", !ready);
      profileStatus.setAttribute("aria-label", ready ? "Service is ready" : "Service setup is needed");
    } catch {
      statusText.textContent = "Unavailable";
      statusDot.classList.add("offline");
      profileStatus.classList.add("offline");
      profileStatus.setAttribute("aria-label", "Service is unavailable");
    }
  }

  function appendUserMessage(message, imageUrl) {
    const row = document.createElement("article");
    row.className = "message user";
    const content = document.createElement("div");
    content.className = "message-content";
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "message-image";
      image.src = imageUrl;
      image.alt = "Image attached to the question";
      content.append(image);
    }
    if (message) {
      const text = document.createElement("div");
      text.textContent = message;
      content.append(text);
    }
    row.append(content);
    messageList.append(row);
    scrollToLatest();
  }

  function appendPendingMessage() {
    const row = document.createElement("article");
    row.className = "message assistant";
    row.dataset.pending = "true";
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "+";
    avatar.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "message-content";
    const label = document.createElement("div");
    label.className = "assistant-label";
    label.textContent = "Carewise is thinking";
    const dots = document.createElement("div");
    dots.className = "loading-dots";
    dots.setAttribute("aria-label", "Loading response");
    dots.innerHTML = "<span></span><span></span><span></span>";
    content.append(label, dots);
    row.append(avatar, content);
    messageList.append(row);
    scrollToLatest();
    return row;
  }

  function appendTextWithEmphasis(parent, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.append(strong);
      } else {
        parent.append(document.createTextNode(part));
      }
    }
  }

  function renderAnswerText(container, answer) {
    const lines = answer.replace(/\r\n/g, "\n").split("\n");
    let list = null;
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const element = document.createElement("p");
      appendTextWithEmphasis(element, paragraph.join(" "));
      container.append(element);
      paragraph = [];
    };
    const endList = () => {
      list = null;
      listType = null;
    };

    for (const line of lines) {
      const item = line.match(/^\s*(?:[-*]\s+|\d+[.)]\s+)(.*)$/);
      if (item) {
        flushParagraph();
        const nextType = /^\s*\d+[.)]\s+/.test(line) ? "ol" : "ul";
        if (nextType !== listType) {
          endList();
          list = document.createElement(nextType);
          listType = nextType;
          container.append(list);
        }
        const li = document.createElement("li");
        appendTextWithEmphasis(li, item[1]);
        list.append(li);
      } else if (!line.trim()) {
        flushParagraph();
        endList();
      } else {
        endList();
        paragraph.push(line.trim());
      }
    }
    flushParagraph();
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function appendSources(container, sources) {
    if (!Array.isArray(sources) || !sources.length) return;
    const list = document.createElement("div");
    list.className = "source-list";
    for (const source of sources) {
      const title = source.type === "pdf"
        ? `Gale Encyclopedia · p. ${source.page ?? "—"}`
        : (source.title || "Web source");
      const safeUrl = source.type === "web" ? safeSourceUrl(source.url) : null;
      const chip = safeUrl ? document.createElement("a") : document.createElement("span");
      chip.className = "source-chip";
      if (safeUrl) {
        chip.href = safeUrl;
        chip.target = "_blank";
        chip.rel = "noopener noreferrer";
      }
      chip.innerHTML = icon.external;
      const label = document.createElement("span");
      label.textContent = title;
      chip.append(label);
      list.append(chip);
    }
    container.append(list);
  }

  function appendAssistantMessage(answer, sources = []) {
    const row = document.createElement("article");
    row.className = "message assistant";
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "+";
    avatar.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "message-content";
    const label = document.createElement("div");
    label.className = "assistant-label";
    label.textContent = "Carewise";
    const text = document.createElement("div");
    text.className = "assistant-text";
    renderAnswerText(text, answer);
    content.append(label, text);
    appendSources(content, sources);

    const actions = document.createElement("div");
    actions.className = "message-tools";
    const copyButton = document.createElement("button");
    copyButton.className = "message-tool";
    copyButton.type = "button";
    copyButton.innerHTML = `${icon.copy}<span>Copy</span>`;
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(answer);
        showToast("Response copied to clipboard.");
      } catch {
        showToast("Could not copy automatically. Select the response to copy it.");
      }
    });
    const speakButton = document.createElement("button");
    speakButton.className = "message-tool";
    speakButton.type = "button";
    speakButton.innerHTML = `${icon.speak}<span>Listen</span>`;
    speakButton.addEventListener("click", () => speakAnswer(answer, speakButton));
    actions.append(copyButton, speakButton);
    content.append(actions);
    row.append(avatar, content);
    messageList.append(row);
    scrollToLatest();
  }

  function appendErrorMessage(message) {
    const row = document.createElement("article");
    row.className = "message assistant";
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "+";
    avatar.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "message-content";
    const label = document.createElement("div");
    label.className = "assistant-label";
    label.textContent = "Carewise";
    const error = document.createElement("div");
    error.className = "error-message";
    error.textContent = message;
    content.append(label, error);
    row.append(avatar, content);
    messageList.append(row);
    scrollToLatest();
  }

  function scrollToLatest() {
    window.requestAnimationFrame(() => {
      messageList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function speakAnswer(answer, button) {
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = `${icon.speak}<span>Preparing audio…</span>`;
    let audioUrl = null;
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer.slice(0, 3000) }),
      });
      if (!response.ok) throw new Error(await getErrorDetail(response));
      const audioBlob = await response.blob();
      audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
      audio.addEventListener("error", () => URL.revokeObjectURL(audioUrl), { once: true });
      await audio.play();
      button.innerHTML = `${icon.speak}<span>Playing</span>`;
      audio.addEventListener("ended", () => {
        button.innerHTML = original;
        button.disabled = false;
      }, { once: true });
    } catch (error) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      showToast(error.message || "Audio playback is unavailable.");
      button.innerHTML = original;
      button.disabled = false;
    }
  }

  async function getErrorDetail(response) {
    try {
      const body = await response.json();
      return typeof body.detail === "string" ? body.detail : "The request could not be completed.";
    } catch {
      return "The request could not be completed.";
    }
  }

  function setImage(file) {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      showToast("Choose a JPEG, PNG, or WebP image.");
      imageInput.value = "";
      return;
    }
    if (file.size > 5_000_000) {
      showToast("Images must be smaller than 5 MB.");
      imageInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      selectedImage = { data: reader.result, name: file.name };
      imagePreview.src = reader.result;
      attachmentName.textContent = file.name;
      attachmentPreview.hidden = false;
      updateSendButton();
    });
    reader.addEventListener("error", () => showToast("Could not read that image. Please try another."));
    reader.readAsDataURL(file);
  }

  function clearImage() {
    selectedImage = null;
    imageInput.value = "";
    imagePreview.removeAttribute("src");
    attachmentPreview.hidden = true;
    updateSendButton();
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      if (MediaRecorder.isTypeSupported("audio/webm")) options.mimeType = "audio/webm";
      recorder = new MediaRecorder(stream, options);
      audioChunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) audioChunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        voiceButton.classList.remove("recording");
        voiceButton.setAttribute("aria-label", "Record a voice message");
        voiceStatus.textContent = "Transcribing…";
        const blob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 10_000_000) {
          voiceStatus.textContent = "";
          showToast("Audio must be smaller than 10 MB.");
          return;
        }
        try {
          const audioFile = new File([blob], "voice.webm", { type: blob.type || "audio/webm" });
          const data = new FormData();
          data.append("file", audioFile);
          const response = await fetch("/api/transcribe", { method: "POST", body: data });
          if (!response.ok) throw new Error(await getErrorDetail(response));
          const result = await response.json();
          if (result.text) {
            input.value = `${input.value}${input.value ? " " : ""}${result.text}`.trimStart();
            resizeInput();
            input.focus();
          }
          voiceStatus.textContent = "";
        } catch (error) {
          voiceStatus.textContent = "";
          showToast(error.message || "Voice transcription is unavailable.");
        }
      }, { once: true });
      recorder.start();
      voiceButton.classList.add("recording");
      voiceButton.setAttribute("aria-label", "Stop recording");
      voiceStatus.textContent = "Recording… click to stop";
    } catch {
      showToast("Microphone access was not granted.");
    }
  }

  async function submitMessage(event) {
    event.preventDefault();
    if (isSending) return;
    const message = input.value.trim();
    if (!message && !selectedImage) return;

    const image = selectedImage;
    const imageUrl = image?.data || null;
    const userQuestion = message || "Please describe this image.";
    welcome.hidden = true;
    appendUserMessage(userQuestion, imageUrl);
    const pending = appendPendingMessage();
    isSending = true;
    newChatButton.disabled = true;
    input.value = "";
    clearImage();
    resizeInput();
    updateSendButton();

    try {
      const headers = { "Content-Type": "application/json" };
      if (conversationId) headers["X-Conversation-ID"] = conversationId;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: userQuestion,
          history: history.slice(-10),
          image_data: image?.data || null,
        }),
      });
      if (!response.ok) throw new Error(await getErrorDetail(response));
      const result = await response.json();
      if (typeof result.answer !== "string" || !result.answer.trim()) {
        throw new Error("The assistant returned an empty response. Please try again.");
      }
      if (typeof result.conversation_id === "string") conversationId = result.conversation_id;
      pending.remove();
      appendAssistantMessage(result.answer, result.sources);
      history.push({ role: "user", content: userQuestion });
      history.push({ role: "assistant", content: result.answer });
      history = history.slice(-10);
    } catch (error) {
      pending.remove();
      appendErrorMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      isSending = false;
      newChatButton.disabled = false;
      input.focus();
      updateSendButton();
    }
  }

  function startNewConversation() {
    history = [];
    conversationId = null;
    messageList.replaceChildren();
    clearImage();
    input.value = "";
    resizeInput();
    welcome.hidden = false;
    sidebar.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    input.focus();
  }

  form.addEventListener("submit", submitMessage);
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelectorAll(".suggestion-card").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.prompt || "";
      resizeInput();
      form.requestSubmit();
    });
  });
  newChatButton.addEventListener("click", startNewConversation);
  document.querySelector("#history-link").addEventListener("click", () => {
    sidebar.classList.remove("open");
    document.querySelector(".conversation").scrollIntoView({ behavior: "smooth", block: "end" });
    input.focus();
  });
  document.querySelector("#attach-button").addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => setImage(imageInput.files?.[0]));
  document.querySelector("#remove-attachment").addEventListener("click", clearImage);
  voiceButton.addEventListener("click", () => {
    if (recorder?.state === "recording") recorder.stop();
    else startVoiceRecording();
  });

  menuToggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  document.querySelector("#about-button").addEventListener("click", () => { aboutModal.hidden = false; });
  document.querySelector("#modal-close").addEventListener("click", () => { aboutModal.hidden = true; });
  document.querySelector("#modal-done").addEventListener("click", () => { aboutModal.hidden = true; });
  aboutModal.addEventListener("click", (event) => {
    if (event.target === aboutModal) aboutModal.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      aboutModal.hidden = true;
      sidebar.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
  checkService();
  resizeInput();
})();