"use strict";

const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const appView = $("#app-view");
const audio = $("#audio-player");
let csrfToken = "";
let tracks = [];
let activeTrackId = "";
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2900);
}

async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!(["GET", "HEAD", "OPTIONS"].includes(method)) && csrfToken) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(url, { ...options, method, headers, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/login") showLogin();
    throw new Error(data.error || "Não foi possível concluir o pedido.");
  }
  return data;
}

async function loadCsrf() {
  const data = await api("/api/csrf");
  csrfToken = data.csrfToken;
}

function setLoggedOut() {
  appView.hidden = true;
  loginView.hidden = false;
  csrfToken = "";
  activeTrackId = "";
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  updatePlayer();
}

function showLogin() {
  setLoggedOut();
  loadCsrf().catch(() => {});
}

async function showApp(username) {
  loginView.hidden = true;
  appView.hidden = false;
  $("#account-name").textContent = username;
  $("#account-avatar").textContent = username.slice(0, 1).toUpperCase();
  await loadTracks();
}

function escapeFormat(mimeType) {
  const subtype = (mimeType || "audio").split("/").pop().split(";")[0];
  return subtype.replace("mpeg", "MP3").replace("x-", "").toUpperCase().slice(0, 5);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date).replace(" de ", " ");
}

function makeTrackButton(track, index, sidebar = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = sidebar ? "sidebar-track" : "row-action";
  button.dataset.play = track.id;
  button.setAttribute("aria-label", `Tocar ${track.title}`);
  if (sidebar) {
    const art = document.createElement("span");
    art.className = `sidebar-track-art art-${index % 5}`;
    art.textContent = "♫";
    const copy = document.createElement("span");
    copy.className = "sidebar-track-copy";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const artist = document.createElement("span");
    artist.textContent = track.artist;
    copy.append(title, artist);
    button.append(art, copy);
  } else {
    button.textContent = activeTrackId === track.id && !audio.paused ? "Ⅱ" : "▶";
  }
  return button;
}

function renderTracks() {
  const filtered = tracks.filter((track) => {
    const query = $("#search-input").value.trim().toLocaleLowerCase("pt-BR");
    return !query || `${track.title} ${track.artist}`.toLocaleLowerCase("pt-BR").includes(query);
  });
  $("#track-count").textContent = String(tracks.length);
  $("#empty-state").hidden = tracks.length > 0;
  $("#track-list").hidden = tracks.length === 0;
  const rowContainer = $("#track-rows");
  const sidebar = $("#sidebar-library");
  rowContainer.replaceChildren();
  sidebar.replaceChildren();
  if (!tracks.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "As músicas que você adicionar aparecem aqui.";
    sidebar.append(empty);
    return;
  }
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "Nenhuma música corresponde à busca.";
    sidebar.append(empty);
    return;
  }
  filtered.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "track-row";
    const number = document.createElement("span");
    number.className = "track-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const main = document.createElement("div");
    main.className = "track-main";
    const art = document.createElement("span");
    art.className = `track-art art-${index % 5}`;
    art.textContent = "♫";
    const copy = document.createElement("span");
    copy.className = "track-copy";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const artist = document.createElement("span");
    artist.textContent = track.artist;
    copy.append(title, artist);
    main.append(art, copy);
    const format = document.createElement("span");
    format.className = "track-format";
    format.textContent = escapeFormat(track.mimeType);
    const date = document.createElement("span");
    date.className = "track-date";
    date.textContent = formatDate(track.createdAt);
    const actions = document.createElement("span");
    actions.className = "track-actions";
    actions.append(makeTrackButton(track, index));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "row-action delete";
    remove.dataset.delete = track.id;
    remove.setAttribute("aria-label", `Remover ${track.title}`);
    remove.title = "Remover música";
    remove.textContent = "×";
    actions.append(remove);
    row.append(number, main, format, date, actions);
    rowContainer.append(row);
    sidebar.append(makeTrackButton(track, index, true));
  });
}

async function loadTracks() {
  const data = await api("/api/tracks");
  tracks = data.tracks;
  renderTracks();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function updatePlayer() {
  const track = tracks.find((item) => item.id === activeTrackId);
  $("#player-title").textContent = track?.title || "Escolha uma música";
  $("#player-artist").textContent = track?.artist || "Sua biblioteca está esperando";
  $("#play-button").disabled = !track;
  $("#play-button").textContent = !track || audio.paused ? "▶" : "Ⅱ";
  $("#play-button").setAttribute("aria-label", !track || audio.paused ? "Reproduzir" : "Pausar");
  $("#progress-input").disabled = !track || !Number.isFinite(audio.duration);
  $("#current-time").textContent = formatTime(audio.currentTime);
  $("#duration-time").textContent = formatTime(audio.duration);
  const progress = Number.isFinite(audio.duration) && audio.duration > 0 ? (audio.currentTime / audio.duration) * 1000 : 0;
  $("#progress-input").value = String(progress);
  $("#playing-indicator").classList.toggle("active", Boolean(track && !audio.paused));
  $("#player-art").className = `mini-art ${track ? "art-" + (tracks.indexOf(track) % 5) : ""}`;
  $("#player-art").textContent = "♫";
  renderTracks();
}

async function playTrack(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  if (activeTrackId === id && !audio.paused) {
    audio.pause();
    updatePlayer();
    return;
  }
  if (activeTrackId !== id) {
    activeTrackId = id;
    audio.src = `/api/tracks/${encodeURIComponent(id)}/audio`;
  }
  try {
    await audio.play();
  } catch {
    showToast("O navegador não conseguiu reproduzir esse arquivo de áudio.");
  }
  updatePlayer();
}

function playRelative(direction) {
  if (!tracks.length) return;
  const currentIndex = tracks.findIndex((track) => track.id === activeTrackId);
  const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : tracks.length - 1) : (currentIndex + direction + tracks.length) % tracks.length;
  playTrack(tracks[nextIndex].id);
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function setError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

async function boot() {
  try {
    await loadCsrf();
    const me = await api("/api/me");
    await showApp(me.username);
  } catch (error) {
    if (error.message && !error.message.includes("Entre na sua conta")) setError($("#login-error"), error.message);
    setLoggedOut();
    loadCsrf().catch(() => {});
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError($("#login-error"));
  const button = $("#login-button");
  button.disabled = true;
  button.textContent = "Entrando…";
  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: $("#username").value, password: $("#password").value })
    });
    csrfToken = data.csrfToken;
    $("#login-form").reset();
    await showApp(data.username);
  } catch (error) {
    setError($("#login-error"), error.message);
    await loadCsrf().catch(() => {});
  } finally {
    button.disabled = false;
    button.innerHTML = 'Entrar <span aria-hidden="true">→</span>';
  }
});

for (const button of [$("#hero-add"), $("#section-add"), $("#empty-add"), $("#sidebar-add")]) {
  button.addEventListener("click", () => openDialog("upload-dialog"));
}
$("#search-focus").addEventListener("click", () => $("#search-input").focus());
$("#search-input").addEventListener("input", renderTracks);
$("#search-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.currentTarget.value = ""; renderTracks(); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $("#search-input").focus();
  }
});

$("#account-menu-button").addEventListener("click", () => {
  $("#account-menu").hidden = !$("#account-menu").hidden;
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-area")) $("#account-menu").hidden = true;
});
$("#change-password-open").addEventListener("click", () => {
  $("#account-menu").hidden = true;
  setError($("#password-error"));
  $("#password-form").reset();
  openDialog("password-dialog");
});
$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    setLoggedOut();
    await loadCsrf();
  } catch (error) { showToast(error.message); }
});

for (const closeButton of document.querySelectorAll("[data-close]")) {
  closeButton.addEventListener("click", () => document.getElementById(closeButton.dataset.close).close());
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

$("#track-file").addEventListener("change", () => {
  const file = $("#track-file").files[0];
  if (file && !$("#track-title").value.trim()) {
    $("#track-title").value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  }
});
$("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError($("#upload-error"));
  const button = $("#upload-submit");
  button.disabled = true;
  button.textContent = "Enviando música…";
  try {
    const formData = new FormData(event.currentTarget);
    await api("/api/tracks", { method: "POST", body: formData });
    event.currentTarget.reset();
    $("#upload-dialog").close();
    await loadTracks();
    showToast("Música adicionada à biblioteca.");
  } catch (error) {
    setError($("#upload-error"), error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Adicionar à biblioteca";
  }
});

$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError($("#password-error"));
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") })
    });
    csrfToken = data.csrfToken;
    $("#password-dialog").close();
    showToast("Senha alterada com sucesso.");
  } catch (error) {
    setError($("#password-error"), error.message);
  }
});

$("#track-rows").addEventListener("click", async (event) => {
  const playButton = event.target.closest("[data-play]");
  const deleteButton = event.target.closest("[data-delete]");
  if (playButton) await playTrack(playButton.dataset.play);
  if (deleteButton) {
    const track = tracks.find((item) => item.id === deleteButton.dataset.delete);
    if (!track || !window.confirm(`Remover “${track.title}” da biblioteca?`)) return;
    try {
      await api(`/api/tracks/${encodeURIComponent(track.id)}`, { method: "DELETE" });
      if (activeTrackId === track.id) { audio.pause(); activeTrackId = ""; audio.removeAttribute("src"); audio.load(); }
      await loadTracks();
      updatePlayer();
      showToast("Música removida.");
    } catch (error) { showToast(error.message); }
  }
});
$("#sidebar-library").addEventListener("click", (event) => {
  const button = event.target.closest("[data-play]");
  if (button) playTrack(button.dataset.play);
});
$("#play-button").addEventListener("click", () => {
  if (!activeTrackId && tracks.length) return playTrack(tracks[0].id);
  if (audio.paused) audio.play().catch(() => showToast("Não foi possível iniciar a reprodução."));
  else audio.pause();
  updatePlayer();
});
$("#previous-button").addEventListener("click", () => playRelative(-1));
$("#next-button").addEventListener("click", () => playRelative(1));
$("#progress-input").addEventListener("input", (event) => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
});
$("#volume-input").addEventListener("input", (event) => {
  audio.volume = Number(event.target.value);
  $("#volume-label").textContent = `${Math.round(audio.volume * 100)}%`;
});
audio.volume = Number($("#volume-input").value);
for (const eventName of ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "ended", "error"]) {
  audio.addEventListener(eventName, () => {
    if (eventName === "ended") playRelative(1);
    else updatePlayer();
  });
}

boot();
