// Interactive app window in the hero, copy buttons, sticky header. Works offline, no external requests.
(() => {
  for (const button of document.querySelectorAll("[data-copy]")) {
    const status = button.parentElement.querySelector("[data-copy-status]");
    let timer = 0;
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      clearTimeout(timer);
      try {
        await navigator.clipboard.writeText(source.textContent);
        button.classList.add("copied");
        status.textContent = "Command copied";
      } catch {
        window.getSelection().selectAllChildren(source);
        status.textContent = "Command selected. Press Command-C to copy it.";
      }
      timer = setTimeout(() => {
        button.classList.remove("copied");
        status.textContent = "";
      }, 1600);
    });
  }

  const top = document.querySelector(".top");
  const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const win = document.querySelector("[data-demo]");
  if (!win) return;

  // The same rules as EditorModel and TimelineDragController in the app, in seconds.
  const duration = 20.48;
  const frameStep = 1 / 30;
  const minLength = 0.1;
  const longSkip = 5;
  const shortSkip = 1;
  const moveThreshold = 3;

  const state = {
    start: 0.18 * duration,
    end: 0.64 * duration,
    time: 0.37 * duration,
    preview: null,
    playing: false,
    loop: false,
    selected: null,
  };

  const timeline = win.querySelector(".timeline");
  const track = win.querySelector(".track");
  const scene = win.querySelector(".scene");
  const handles = { start: win.querySelector(".handle.l"), end: win.querySelector(".handle.r") };
  const play = win.querySelector("[data-play]");
  const loop = win.querySelector("[data-loop]");
  const toast = win.querySelector(".toast:not(.frame-toast)");
  const frameToast = win.querySelector(".frame-toast");
  const frameName = frameToast.querySelector("[data-frame-name]");
  const announce = win.querySelector("[data-announce]");
  const out = Object.fromEntries([...win.querySelectorAll("[data-t]")].map((el) => [el.dataset.t, el]));

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const format = (seconds) => {
    const cs = Math.round(seconds * 100);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor((cs % 6000) / 100))}.${pad(cs % 100)}`;
  };

  const render = () => {
    timeline.style.setProperty("--s", state.start / duration);
    timeline.style.setProperty("--e", state.end / duration);
    timeline.style.setProperty("--p", state.time / duration);
    scene.style.setProperty("--p", (state.preview ?? state.time) / duration);
    out.s.textContent = format(state.start);
    out.e.textContent = format(state.end);
    out.len.textContent = format(state.end - state.start);
    out.now.textContent = format(state.time);
    for (const [key, el] of Object.entries(handles)) {
      el.classList.toggle("selected", state.selected === key);
      el.setAttribute("aria-valuenow", state[key].toFixed(2));
      el.setAttribute("aria-valuetext", format(state[key]));
    }
  };

  // Model. The playhead stays within the selection; an edge that runs into it pushes it along.

  const keepPlayheadInSelection = () => {
    state.time = clamp(state.time, state.start, state.end);
  };

  const applyHandle = (handle, time) => {
    if (handle === "start") state.start = clamp(time, 0, state.end - minLength);
    else state.end = clamp(time, state.start + minLength, duration);
    keepPlayheadInSelection();
  };

  const seek = (time) => {
    state.preview = null;
    state.time = clamp(time, state.start, state.end);
  };

  const scrub = (time) => {
    pause();
    seek(time);
  };

  const step = (frames) => {
    pause();
    seek(state.time + frames * frameStep);
  };

  const nudge = (handle, seconds) => {
    applyHandle(handle, state[handle] + seconds);
    if (!state.playing) seek(state[handle]);
  };

  // While an edge or the whole selection is dragged, the picture shows the edge and the playhead stays put.
  const moveSelection = (offset) => {
    const length = state.end - state.start;
    state.start = clamp(state.start + offset, 0, duration - length);
    state.end = state.start + length;
    keepPlayheadInSelection();
    state.preview = state.start;
  };

  let frame = 0;
  let last = 0;

  const tick = (now) => {
    state.time += (now - last) / 1000;
    last = now;
    if (state.time >= state.end) {
      if (state.loop) state.time = state.start;
      else {
        state.time = state.end;
        pause();
      }
    }
    render();
    if (state.playing) frame = requestAnimationFrame(tick);
  };

  function pause() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(frame);
    win.classList.remove("playing");
    play.setAttribute("aria-label", play.dataset.labelPlay);
  }

  const togglePlayback = () => {
    state.preview = null;
    if (state.playing) return pause();
    if (state.time >= state.end) state.time = state.start;
    state.playing = true;
    win.classList.add("playing");
    play.setAttribute("aria-label", play.dataset.labelPause);
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  // Pointer: one hit test for the whole timeline, as TimelineGeometry.target does.

  const geometry = () => {
    const box = timeline.getBoundingClientRect();
    const handleWidth = parseFloat(getComputedStyle(timeline).paddingLeft);
    const trackWidth = box.width - 2 * handleWidth;
    return {
      handleWidth,
      x: (time) => box.left + handleWidth + (time / duration) * trackWidth,
      time: (clientX) => ((clientX - box.left - handleWidth) / trackWidth) * duration,
    };
  };

  const target = (event) => {
    // The playhead knob sits above the track, so anything grabbed up there is the playhead.
    if (event.clientY < track.getBoundingClientRect().top) return "playhead";
    const g = geometry();
    const touch = event.pointerType === "touch";
    const slop = touch ? 12 : 4;
    const grab = touch ? 12 : 5;
    const x = event.clientX;
    const startX = g.x(state.start);
    const endX = g.x(state.end);
    if (x >= startX - g.handleWidth - slop && x <= startX) return "start";
    if (x >= endX && x <= endX + g.handleWidth + slop) return "end";
    if (Math.abs(x - g.x(state.time)) <= grab) return "playhead";
    if (x > startX && x < endX) return "selection";
    return "track";
  };

  const cursors = { start: "ew-resize", end: "ew-resize", playhead: "ew-resize", selection: "grab", track: "default" };
  let action = null;

  timeline.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    win.focus({ preventScroll: true });
    timeline.setPointerCapture(event.pointerId);
    const kind = target(event);
    const grabTime = geometry().time(event.clientX);
    if (kind === "start" || kind === "end") {
      state.selected = kind;
      pause();
      action = { kind, startTime: state[kind], grabTime };
    } else if (kind === "selection") {
      action = { kind, startTime: state.start, grabTime, x: event.clientX, moving: false };
    } else {
      state.selected = null;
      action = { kind: "scrub" };
      scrub(grabTime);
    }
    render();
  });

  timeline.addEventListener("pointermove", (event) => {
    if (!action) {
      timeline.style.cursor = cursors[target(event)];
      return;
    }
    const pointerTime = geometry().time(event.clientX);
    if (action.kind === "start" || action.kind === "end") {
      applyHandle(action.kind, action.startTime + pointerTime - action.grabTime);
      state.preview = state[action.kind];
    } else if (action.kind === "selection") {
      if (!action.moving && Math.abs(event.clientX - action.x) < moveThreshold) return;
      if (!action.moving) pause();
      action.moving = true;
      timeline.style.cursor = "grabbing";
      moveSelection(action.startTime + pointerTime - action.grabTime - state.start);
    } else {
      scrub(pointerTime);
    }
    render();
  });

  const finish = (event) => {
    if (!action) return;
    if (action.kind === "selection" && !action.moving) {
      state.selected = null;
      seek(geometry().time(event.clientX));
    } else if (!state.playing) {
      // The release shows the playhead's frame again.
      state.preview = null;
    }
    action = null;
    timeline.style.cursor = cursors[target(event)];
    render();
  };
  timeline.addEventListener("pointerup", finish);
  timeline.addEventListener("pointercancel", finish);

  // Buttons

  play.addEventListener("click", togglePlayback);
  win.querySelector("[data-back]").addEventListener("click", () => {
    seek(state.time - longSkip);
    render();
  });
  win.querySelector("[data-forward]").addEventListener("click", () => {
    seek(state.time + longSkip);
    render();
  });
  loop.addEventListener("click", () => {
    state.loop = !state.loop;
    loop.classList.toggle("on", state.loop);
    loop.setAttribute("aria-pressed", state.loop);
  });
  win.querySelector("[data-reset]").addEventListener("click", () => {
    state.start = 0;
    state.end = duration;
    seek(0);
    render();
  });

  // The toasts are hidden from screen readers; one status line announces what they show.
  let toastTimer = 0;
  const showToast = (shown, message) => {
    for (const el of [toast, frameToast]) el.classList.toggle("show", el === shown);
    announce.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      shown.classList.remove("show");
      announce.textContent = "";
    }, 2600);
  };

  win.querySelector("[data-save]").addEventListener("click", () => {
    pause();
    out.saved.textContent = format(state.end - state.start);
    showToast(toast, `Clip saved next to the original: ${toast.querySelector("b").textContent}, ${out.saved.textContent}`);
  });
  // The app names the frame after the playhead time, with dashes in place of colons.
  win.querySelector("[data-frame]").addEventListener("click", () => {
    frameName.textContent = frameName.dataset.frameName.replace("{t}", format(state.time).replace(":", "-"));
    showToast(frameToast, `Frame saved: ${frameName.textContent}`);
  });

  // Keys, as in KeyCommandMonitor, while the demo window has focus. I and O go by physical key, so any layout works.

  for (const [key, el] of Object.entries(handles)) {
    el.addEventListener("focus", () => {
      state.selected = key;
      render();
    });
  }

  win.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest("button") && (event.code === "Space" || event.code === "Enter")) return;
    const arrow = { ArrowLeft: -1, ArrowRight: 1 }[event.code];
    if (arrow) {
      if (state.selected) nudge(state.selected, arrow * (event.shiftKey ? shortSkip : frameStep));
      else if (event.shiftKey) seek(state.time + arrow * shortSkip);
      else step(arrow);
    } else {
      switch (event.code) {
        case "Space":
          togglePlayback();
          break;
        case "KeyI":
          applyHandle("start", state.time);
          break;
        case "KeyO":
          applyHandle("end", state.time);
          break;
        case "KeyL":
          loop.click();
          break;
        case "Comma":
          step(-1);
          break;
        case "Period":
          step(1);
          break;
        case "Escape":
          if (!state.selected) return;
          state.selected = null;
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    render();
  });

  render();
})();
