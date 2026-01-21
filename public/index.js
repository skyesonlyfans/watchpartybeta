(function(){
  const $ = (id) => document.getElementById(id);

  const nameEl = $("name");
  const codeEl = $("code");
  const joinBtn = $("joinBtn");
  const hostBtn = $("hostBtn");
  const createBtn = $("createBtn");
  const randomNameBtn = $("randomNameBtn");

  const toastEl = $("toast");

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

  function normalizeCode(code){
    return (code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  }

  function randomName(){
    const adjectives = ["Cozy","Sparkly","Chill","Sunny","Soft","Frosty","Glimmer","Bouncy","Kind","Silly","Witty","Lush","Mellow","Neon","Velvet"];
    const nouns = ["Fox","Cloud","Otter","Comet","Pixel","Boba","Mochi","Daisy","Star","Raccoon","Kitten","Penguin","Skater","Cactus","Jelly"];
    const a = adjectives[Math.floor(Math.random()*adjectives.length)];
    const n = nouns[Math.floor(Math.random()*nouns.length)];
    const num = Math.floor(Math.random()*90+10);
    return `${a}${n}${num}`;
  }

  randomNameBtn.addEventListener("click", ()=>{
    nameEl.value = randomName();
    nameEl.focus();
    toast("good","Cute!","Random name ready.");
  });

  codeEl.addEventListener("input", ()=>{
    const v = normalizeCode(codeEl.value);
    codeEl.value = v;
  });

  function go(role){
    const name = (nameEl.value || "").trim().slice(0,24) || "Guest";
    const code = normalizeCode(codeEl.value);
    if (!code || code.length !== 6){
      toast("warn","Missing room code","Enter a 6-character room code, or create a new room.");
      codeEl.focus();
      return;
    }
    const params = new URLSearchParams({ room: code, name, role });
    window.location.href = `/room.html?${params.toString()}`;
  }

  joinBtn.addEventListener("click", ()=>go("viewer"));
  hostBtn.addEventListener("click", ()=>go("host"));

  createBtn.addEventListener("click", async ()=>{
    const name = (nameEl.value || "").trim().slice(0,24) || "Guest";
    try{
      createBtn.disabled = true;
      createBtn.textContent = "Creating…";
      const res = await fetch("/api/new-room", { method: "POST" });
      const data = await res.json();
      const code = data.roomCode;
      const params = new URLSearchParams({ room: code, name, role: "host" });
      window.location.href = `/room.html?${params.toString()}`;
    }catch(e){
      console.error(e);
      toast("bad","Oops","Could not create a room. Try again.");
    }finally{
      createBtn.disabled = false;
      createBtn.textContent = "Create new room";
    }
  });

  // Default random name if empty
  if (!nameEl.value) nameEl.value = randomName();
})();
