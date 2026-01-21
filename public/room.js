(function(){
  const socket = io();

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);

  const roomCode = (params.get("room") || "").trim().toUpperCase();
  const name = (params.get("name") || "Guest").trim().slice(0,24) || "Guest";
  let role = (params.get("role") || "viewer").trim();

  const roomPill = $("roomPill");
  const rolePill = $("rolePill");
  const countPill = $("countPill");

  const videoEl = $("video");
  const overlay = $("overlay");
  const overlayTitle = $("overlayTitle");
  const overlayText = $("overlayText");
  const overlayActions = $("overlayActions");

  const toastEl = $("toast");

  const sidepanel = $("sidepanel");
  const toggleChatBtn = $("toggleChatBtn");
  const fullscreenBtn = $("fullscreenBtn");
  const copyInviteBtn = $("copyInviteBtn");

  const peopleList = $("peopleList");
  const chatLog = $("chatLog");
  const chatForm = $("chatForm");
  const chatInput = $("chatInput");

  const hostUrl = $("hostUrl");
  const sendUrlBtn = $("sendUrlBtn");
  const hostUrlStatus = $("hostUrlStatus");

  const muteBtn = $("muteBtn");
  const fitBtn = $("fitBtn");
  const theaterBtn = $("theaterBtn");
  const hudNote = $("hudNote");

  if (!roomCode || roomCode.length !== 6){
    window.location.href = "/";
    return;
  }

  roomPill.textContent = `ROOM: ${roomCode}`;
  rolePill.textContent = `ROLE: ${role.toUpperCase()}`;

  function toast(type, title, msg){
    toastEl.className = `toast show ${type || ""}`.trim();
    toastEl.innerHTML = `<div class="t-title">${escapeHtml(title || "")}</div><div class="t-msg">${escapeHtml(msg || "")}</div>`;
    window.clearTimeout(toastEl._t);
    toastEl._t = window.setTimeout(() => {
      toastEl.className = "toast";
    }, 3200);
  }

  function escapeHtml(s){
    return (s||"").replace(/[&<>"']/g, (c)=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function showOverlay(title, text, actions = []){
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayActions.innerHTML = "";
    for (const a of actions){
      const b = document.createElement("button");
      b.className = `btn ${a.primary ? "primary" : ""}`.trim();
      b.textContent = a.label;
      b.addEventListener("click", a.onClick);
      overlayActions.appendChild(b);
    }
    overlay.classList.remove("hidden");
  }
  function hideOverlay(){
    overlay.classList.add("hidden");
  }

  // UI controls
  toggleChatBtn.addEventListener("click", ()=>{
    sidepanel.classList.toggle("show");
  });

  fullscreenBtn.addEventListener("click", ()=>{
    const el = document.querySelector(".video-wrap");
    if (!document.fullscreenElement){
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  copyInviteBtn.addEventListener("click", async ()=>{
    const inviteUrl = `${window.location.origin}/room.html?` + new URLSearchParams({ room: roomCode, name: "Guest", role: "viewer" }).toString();
    try{
      await navigator.clipboard.writeText(inviteUrl);
      toast("good","Copied","Invite link copied to clipboard.");
    }catch{
      // fallback
      prompt("Copy invite link:", inviteUrl);
    }
  });

  muteBtn.addEventListener("click", ()=>{
    videoEl.muted = !videoEl.muted;
    muteBtn.textContent = videoEl.muted ? "Unmute" : "Mute";
  });

  let fitMode = "contain";
  fitBtn.addEventListener("click", ()=>{
    fitMode = (fitMode === "contain") ? "cover" : "contain";
    videoEl.style.objectFit = fitMode;
    fitBtn.textContent = fitMode === "contain" ? "Fit" : "Fill";
  });

  theaterBtn.addEventListener("click", ()=>{
    document.body.classList.toggle("theater");
    theaterBtn.textContent = document.body.classList.contains("theater") ? "Exit theater" : "Theater";
  });

  // Chat
  function appendMsg({ name, role, text, at }){
    const div = document.createElement("div");
    div.className = "msg";
    const time = new Date(at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    div.innerHTML = `
      <div class="meta"><b>${escapeHtml(name)}</b> <span>·</span> <span>${escapeHtml(role || "")}</span> <span>·</span> <span>${escapeHtml(time)}</span></div>
      <div class="text">${escapeHtml(text)}</div>
    `;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  chatForm.addEventListener("submit", (e)=>{
    e.preventDefault();
    const text = (chatInput.value || "").trim();
    if (!text) return;
    socket.emit("chat-message", { roomCode, text });
    chatInput.value = "";
  });

  document.querySelectorAll(".quick-reactions .chip").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const r = btn.getAttribute("data-reaction");
      socket.emit("chat-message", { roomCode, text: r });
    });
  });

  // Host link
  sendUrlBtn.addEventListener("click", ()=>{
    const url = (hostUrl.value || "").trim();
    if (!url) return;
    socket.emit("host-url", { roomCode, url });
    toast("good","Shared","Shared link with the room.");
  });

  // --- WebRTC
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
    ],
  };

  let localStream = null; // host only
  let hostId = null;
  let peers = new Map(); // peerId -> RTCPeerConnection
  let isSharing = false;

  function setHudNote(text){
    hudNote.textContent = text || "";
  }

  function attachStreamToVideo(stream){
    videoEl.srcObject = stream;
    videoEl.play?.().catch(()=>{});
  }

  async function startSharing(){
    if (isSharing) return;
    try{
      setHudNote("Starting screen share…");
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true
      });

      isSharing = true;
      attachStreamToVideo(localStream);
      hideOverlay();
      toast("good","You’re live","Sharing your screen/tab with the room.");

      localStream.getVideoTracks()[0]?.addEventListener("ended", ()=>{
        stopSharing(true);
      });

      // Create offers for existing viewers
      if (hostId === socket.id){
        const viewerIds = Array.from(currentParticipants.values())
          .filter(p => p.role === "viewer")
          .map(p => p.id);
        for (const vid of viewerIds){
          await ensureConnectionToViewer(vid);
        }
      }
    }catch(e){
      console.error(e);
      setHudNote("");
      toast("bad","Share failed","Could not start sharing. Check browser permissions.");
      showOverlay(
        "Start sharing",
        "Click to share a tab/window/screen. Viewers will watch in fullscreen.",
        [{ label: "Try again", primary: true, onClick: startSharing }]
      );
    }
  }

  function stopSharing(silent){
    if (!isSharing) return;
    isSharing = false;

    if (localStream){
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    // Close peers
    for (const pc of peers.values()){
      try{ pc.close(); }catch{}
    }
    peers.clear();

    if (!silent) toast("warn","Stopped","You stopped sharing.");
    showOverlay("Sharing stopped", "You’re no longer streaming. You can start again anytime.", [
      ...(role === "host" ? [{ label:"Start sharing", primary:true, onClick:startSharing }] : []),
      { label:"Back home", onClick: ()=> window.location.href = "/" }
    ]);
  }

  function createPeerConnection(peerId){
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (ev) => {
      if (ev.candidate){
        socket.emit("webrtc-ice", { to: peerId, candidate: ev.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "disconnected"){
        // Soft cleanup
        // Viewer can refresh; host may recreate
      }
    };

    pc.ontrack = (ev) => {
      // Viewer receives media
      const [stream] = ev.streams;
      if (stream) attachStreamToVideo(stream);
      hideOverlay();
      setHudNote("Watching host stream");
    };

    return pc;
  }

  async function ensureConnectionToViewer(viewerId){
    if (!localStream) return;
    if (peers.has(viewerId)) return;

    const pc = createPeerConnection(viewerId);
    peers.set(viewerId, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc-offer", { to: viewerId, sdp: pc.localDescription });
  }

  async function handleOffer({ from, sdp }){
    // Viewer side: from = hostId
    let pc = peers.get(from);
    if (!pc){
      pc = createPeerConnection(from);
      peers.set(from, pc);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc-answer", { to: from, sdp: pc.localDescription });
  }

  async function handleAnswer({ from, sdp }){
    // Host side: from = viewerId
    const pc = peers.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async function handleIce({ from, candidate }){
    const pc = peers.get(from);
    if (!pc) return;
    try{
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }catch(e){
      // may happen if candidate arrives early
    }
  }

  // Participants UI
  const currentParticipants = new Map(); // id -> {id,name,role}
  function renderPeople(hostIdNow){
    peopleList.innerHTML = "";
    const arr = Array.from(currentParticipants.values());
    arr.sort((a,b)=> (a.role === "host" ? -1 : 1) - (b.role === "host" ? -1 : 1));

    for (const p of arr){
      const div = document.createElement("div");
      div.className = "person";
      const isHost = p.id === hostIdNow || p.role === "host";
      const you = p.id === socket.id;
      div.innerHTML = `
        <div>
          <div class="name">${escapeHtml(p.name)} ${you ? "<span class='badge'>YOU</span>" : ""}</div>
        </div>
        <div class="badge">${isHost ? "HOST" : "VIEWER"}</div>
      `;
      peopleList.appendChild(div);
    }
    countPill.textContent = `${arr.length} here`;
  }

  // Socket events
  socket.on("connect", ()=>{
    socket.emit("join-room", { roomCode, name, role });

    showOverlay("Connecting…", "Joining the room and checking for the host.", []);
  });

  socket.on("system-toast", ({ type, message })=>{
    toast(type || "warn", "Note", message || "");
  });

  socket.on("room-state", (state)=>{
    if (!state) return;
    hostId = state.hostId || null;

    currentParticipants.clear();
    for (const p of (state.participants || [])){
      currentParticipants.set(p.id, { id: p.id, name: p.name, role: p.role });
    }

    // If we tried to be host but server forced viewer, update role pill
    const me = currentParticipants.get(socket.id);
    if (me && me.role && me.role !== role){
      role = me.role;
      rolePill.textContent = `ROLE: ${role.toUpperCase()}`;
    }

    renderPeople(hostId);

    // If I'm viewer and host exists, show waiting-for-stream
    if (role === "viewer"){
      if (!hostId){
        showOverlay("No host yet", "Waiting for someone to join as host and start sharing.", [
          { label: "Refresh", primary: true, onClick: ()=>window.location.reload() },
          { label: "Become host", onClick: ()=> window.location.href = `/room.html?` + new URLSearchParams({ room: roomCode, name, role: "host" }).toString() }
        ]);
        setHudNote("Waiting for a host");
      } else {
        showOverlay("Waiting for stream…", "The host is here. Waiting for them to start sharing.", [
          { label: "Refresh", onClick: ()=>window.location.reload() }
        ]);
        setHudNote("Host present, waiting for stream");
      }
    }

    // If I'm host, show share prompt
    if (role === "host"){
      if (hostId && hostId !== socket.id){
        // Another host exists; we're viewer now
        return;
      }
      if (!isSharing){
        showOverlay(
          "Start sharing",
          "Click to share a tab/window/screen. Viewers will watch in fullscreen.",
          [{ label: "Start sharing", primary: true, onClick: startSharing }]
        );
        setHudNote("You are the host");
      }
    }
  });

  socket.on("host-status", ({ hostId: hid })=>{
    hostId = hid || null;
  });

  socket.on("host-left", ()=>{
    // Clean up viewer stream
    attachStreamToVideo(null);
    for (const pc of peers.values()){
      try{ pc.close(); }catch{}
    }
    peers.clear();
    setHudNote("Host left");
    showOverlay("Host left", "The host disconnected. Waiting for a new host.", [
      { label: "Become host", primary:true, onClick: ()=> window.location.href = `/room.html?` + new URLSearchParams({ room: roomCode, name, role: "host" }).toString() },
      { label: "Back home", onClick: ()=> window.location.href = "/" }
    ]);
  });

  socket.on("viewer-joined", async ({ viewerId })=>{
    // Host: create connection for new viewer
    if (role !== "host") return;
    if (!isSharing) return;
    if (viewerId) await ensureConnectionToViewer(viewerId);
  });

  socket.on("chat-message", (msg)=>{
    appendMsg(msg);
  });

  socket.on("host-url", ({ url })=>{
    hostUrl.value = url || "";
    if (url){
      hostUrlStatus.innerHTML = `Host shared: <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open link</a>`;
    } else {
      hostUrlStatus.textContent = "Viewers can open the link while watching the stream.";
    }
  });

  socket.on("webrtc-offer", async (payload)=>{
    try{
      await handleOffer(payload);
    }catch(e){
      console.error(e);
      toast("bad","WebRTC error","Could not connect to stream. Try refreshing.");
    }
  });
  socket.on("webrtc-answer", async (payload)=>{
    try{
      await handleAnswer(payload);
    }catch(e){ console.error(e); }
  });
  socket.on("webrtc-ice", async (payload)=>{
    try{
      await handleIce(payload);
    }catch(e){ /* ignore */ }
  });

  // Start muted for viewers by default (prevents surprise audio)
  if (role === "viewer"){
    videoEl.muted = true;
    muteBtn.textContent = "Unmute";
  }

  // Click video to toggle fullscreen
  videoEl.addEventListener("dblclick", ()=>{
    const wrap = document.querySelector(".video-wrap");
    if (!document.fullscreenElement){
      wrap.requestFullscreen?.();
    }else{
      document.exitFullscreen?.();
    }
  });

})();
