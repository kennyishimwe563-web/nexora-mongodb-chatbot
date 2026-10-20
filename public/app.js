const $ = id => document.getElementById(id);
let user = null,
    chats = [],
    activeId = null,
    authMode = "login",
    busy = false;
async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
}
window.toggleTheme = function() {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem("nexora-theme", isDark ? "dark" : "light");
};
if (localStorage.getItem("nexora-theme") === "dark") document.body.classList.add("dark");

function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    $("authTitle").textContent = signup ? "Create your account" : "Welcome back";
    $("authSub").textContent = signup ? "Join Nexora and explore ideas with AI." : "Sign in to continue your journey with Nexora.";
    $("nameField").classList.toggle("hidden", !signup);
    $("confirmField").classList.toggle("hidden", !signup);
    $("name").required = signup;
    $("confirm").required = signup;
    $("password").autocomplete = signup ? "new-password" : "current-password";
    $("authSubmit").textContent = signup ? "Create account ->" : "Sign in to Nexora ->";
    $("switchText").textContent = signup ? "Already have an account?" : "Don't have an account?";
    $("switchBtn").textContent = signup ? "Sign in" : "Create one";
    $("authError").textContent = "";
}
$("switchBtn").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
$("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("authError").textContent = "";
    const payload = { email: $("email").value.trim(), password: $("password").value };
    if (authMode === "signup") {
        payload.name = $("name").value.trim();
        if (payload.password !== $("confirm").value) { $("authError").textContent = "Passwords do not match."; return; }
    }
    $("authSubmit").disabled = true;
    try {
        const result = await api(authMode === "signup" ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
        user = result.user;
        await enterApp();
    } catch (err) { $("authError").textContent = err.message; } finally { $("authSubmit").disabled = false; }
});
async function enterApp() {
    $("auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("userName").textContent = user.name;
    $("userAvatar").textContent = user.name.charAt(0).toUpperCase();
    await loadChats();
    if (!chats.length) await createChat();
    else await selectChat(chats[0].id);
}
async function loadChats() {
    const result = await api("/api/chats");
    chats = result.chats;
    renderHistory();
}

function renderHistory() {
    const root = $("history");
    root.replaceChildren();
    chats.forEach(chat => {
        const b = document.createElement("button");
        b.className = "hist" + (chat.id === activeId ? " active" : "");
        b.textContent = ">  " + chat.title;
        b.title = chat.title;
        b.onclick = () => selectChat(chat.id);
        root.appendChild(b);
    });
}
async function createChat() {
    try {
        const result = await api("/api/chats", { method: "POST", body: "{}" });
        chats.unshift({...result.chat, messages: [] });
        activeId = result.chat.id;
        renderHistory();
        renderMessages([]);
        $("sidebar").classList.remove("open");
        $("message").focus();
    } catch (err) { showChatError(err.message); }
}
async function selectChat(id) {
    try {
        const result = await api("/api/chats/" + encodeURIComponent(id));
        activeId = result.chat.id;
        const i = chats.findIndex(c => c.id === activeId);
        if (i >= 0) chats[i] = result.chat;
        renderHistory();
        renderMessages(result.chat.messages || []);
        $("sidebar").classList.remove("open");
    } catch (err) { showChatError(err.message); }
}

function renderMessages(messages) {
    const root = $("conversation");
    root.replaceChildren();
    if (!messages.length) {
        const welcome = document.createElement("div");
        welcome.className = "welcome";
        welcome.innerHTML = `<div class="welcome-logo">*</div><h1>Where will your ideas <span class="gradient">take you?</span></h1><p>I'm Nexora, your AI chat companion.<br>Ask a question, explore a topic, or create something new.</p><div class="suggestions"><button class="suggestion" data-prompt="Explain artificial intelligence in simple terms"><strong>* Learn something new</strong><small>Explain a complex topic in simple terms.</small></button><button class="suggestion" data-prompt="Help me brainstorm a creative website idea"><strong>> Brainstorm ideas</strong><small>Turn your thoughts into something exciting.</small></button><button class="suggestion" data-prompt="Teach me the basics of JavaScript"><strong>Code: Write some code</strong><small>Learn programming step by step.</small></button><button class="suggestion" data-prompt="Help me create a productive study plan"><strong>- Plan your day</strong><small>Organize your goals and priorities.</small></button></div>`;
        root.appendChild(welcome);
    } else messages.forEach(m => addMessage(m.role === "user" ? "user" : "assistant", m.content));
    $("messages").scrollTop = $("messages").scrollHeight;
}

function addMessage(role, content) {
    const welcome = $("conversation").querySelector(".welcome");
    if (welcome) welcome.remove();
    const row = document.createElement("div");
    row.className = "msg " + role;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? user.name.charAt(0).toUpperCase() : "*";
    const body = document.createElement("div");
    body.className = "msgbody";
    const name = document.createElement("div");
    name.className = "msgname";
    name.textContent = role === "user" ? user.name : "Nexora AI";
    const text = document.createElement("div");
    text.className = "msgtext";
    text.textContent = String(content ?? "");
    body.append(name, text);
    row.append(avatar, body);
    $("conversation").appendChild(row);
}

function showChatError(message) { $("chatError").textContent = message || ""; }
$("newChat").addEventListener("click", createChat);
$("logout").addEventListener("click", async() => {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    user = null;
    chats = [];
    activeId = null;
    $("app").classList.add("hidden");
    $("auth").classList.remove("hidden");
    $("password").value = "";
    setAuthMode("login");
});
$("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
document.addEventListener("click", e => {
    const s = e.target.closest("[data-prompt]");
    if (s) {
        $("message").value = s.dataset.prompt;
        sendMessage();
    }
});
$("chatForm").addEventListener("submit", e => {
    e.preventDefault();
    sendMessage();
});
$("message").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
$("message").addEventListener("input", () => {
    $("message").style.height = "auto";
    $("message").style.height = Math.min($("message").scrollHeight, 140) + "px";
});
async function sendMessage() {
    const input = $("message"),
        message = input.value.trim();
    if (!message || busy || !activeId) return;
    busy = true;
    $("send").disabled = true;
    showChatError("");
    input.value = "";
    input.style.height = "auto";
    addMessage("user", message);
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.textContent = "Nexora is thinking...";
    $("conversation").appendChild(typing);
    $("messages").scrollTop = $("messages").scrollHeight;
    try {
        const result = await api(`/api/chats/${encodeURIComponent(activeId)}/messages`, { method: "POST", body: JSON.stringify({ message }) });
        typing.remove();
        addMessage("assistant", result.message.content);
        await loadChats();
        $("messages").scrollTop = $("messages").scrollHeight;
    } catch (err) {
        typing.remove();
        showChatError(err.message);
    } finally {
        busy = false;
        $("send").disabled = false;
        input.focus();
    }
}
(async function init() {
    try {
        const result = await api("/api/auth/me");
        user = result.user;
        await enterApp();
    } catch {
        $("auth").classList.remove("hidden");
        $("app").classList.add("hidden");
    }
})();


document.querySelectorAll("[data-theme-toggle]").forEach(button => {
    button.addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark");
        localStorage.setItem("nexora-theme", isDark ? "dark" : "light");
    });
});