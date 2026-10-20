import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

// Environment configuration
if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required in .env");
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
}

// MongoDB
await mongoose.connect(process.env.MONGODB_URI);
console.log("MongoDB connected");

// Database schemas
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 254
    },
    passwordHash: {
        type: String,
        required: true,
        select: false
    }
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },
    title: {
        type: String,
        default: "New conversation",
        maxlength: 120
    },
    messages: [{
        role: {
            type: String,
            enum: ["user", "assistant"],
            required: true
        },
        content: {
            type: String,
            required: true,
            maxlength: 12000
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
const Chat = mongoose.model("Chat", chatSchema);

// Groq uses an OpenAI-compatible API.
const ai = process.env.GROQ_API_KEY ?
    new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1"
    }) :
    null;

// Middleware
app.disable("x-powered-by");

if (production) {
    app.set("trust proxy", 1);
}

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: production ? [] : null
            }
        }
    })
);

app.use(express.json({ limit: "30kb" }));

app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        name: "nexora.sid",
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        store: MongoStore.create({
            mongoUrl: process.env.MONGODB_URI,
            collectionName: "sessions",
            ttl: 604800
        }),
        cookie: {
            httpOnly: true,
            secure: production,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
});

const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
});

const emailIsValid = (value) =>
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Please sign in to continue."
        });
    }
    next();
}

function safeUser(user) {
    return {
        id: user.id || String(user._id),
        name: user.name,
        email: user.email
    };
}

// Health check
app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        database: mongoose.connection.readyState === 1 ?
            "connected" : "disconnected",
        aiConfigured: Boolean(ai)
    });
});

// Register
app.post("/api/auth/register", authLimiter, async(req, res, next) => {
    try {
        const name =
            typeof req.body.name === "string" ? req.body.name.trim() : "";
        const email =
            typeof req.body.email === "string" ?
            req.body.email.trim().toLowerCase() :
            "";
        const password =
            typeof req.body.password === "string" ? req.body.password : "";

        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({
                error: "Name must be 2–80 characters."
            });
        }

        if (!emailIsValid(email)) {
            return res.status(400).json({
                error: "Enter a valid email address."
            });
        }

        if (password.length < 10 || password.length > 128) {
            return res.status(400).json({
                error: "Password must be 10–128 characters."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({ name, email, passwordHash });

        req.session.regenerate((err) => {
            if (err) return next(err);

            req.session.userId = String(user._id);

            req.session.save((saveErr) => {
                if (saveErr) return next(saveErr);
                res.status(201).json({ user: safeUser(user) });
            });
        });
    } catch (err) {
        if (err?.code === 11000) {
            return res.status(409).json({
                error: "An account with this email already exists."
            });
        }
        next(err);
    }
});

// Login
app.post("/api/auth/login", authLimiter, async(req, res, next) => {
    try {
        const email =
            typeof req.body.email === "string" ?
            req.body.email.trim().toLowerCase() :
            "";
        const password =
            typeof req.body.password === "string" ? req.body.password : "";

        if (!emailIsValid(email) || !password) {
            return res.status(400).json({
                error: "Enter your email and password."
            });
        }

        const user = await User.findOne({ email }).select("+passwordHash");

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                error: "Email or password is incorrect."
            });
        }

        req.session.regenerate((err) => {
            if (err) return next(err);

            req.session.userId = String(user._id);

            req.session.save((saveErr) => {
                if (saveErr) return next(saveErr);
                res.json({ user: safeUser(user) });
            });
        });
    } catch (err) {
        next(err);
    }
});

// Current user
app.get("/api/auth/me", async(req, res, next) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Not signed in." });
        }

        const user = await User.findById(req.session.userId).lean();

        if (!user) {
            return req.session.destroy(() =>
                res.status(401).json({
                    error: "Please sign in again."
                })
            );
        }

        res.json({ user: safeUser(user) });
    } catch (err) {
        next(err);
    }
});

// Logout
app.post("/api/auth/logout", (req, res, next) => {
    req.session.destroy((err) => {
        if (err) return next(err);

        res.clearCookie("nexora.sid", {
            httpOnly: true,
            secure: production,
            sameSite: "lax"
        });

        res.json({ ok: true });
    });
});

// List conversations
app.get("/api/chats", requireAuth, async(req, res, next) => {
    try {
        const chats = await Chat.find({
                userId: req.session.userId
            })
            .sort({ updatedAt: -1 })
            .limit(100)
            .lean();

        res.json({
            chats: chats.map((chat) => ({
                id: String(chat._id),
                title: chat.title,
                messages: chat.messages,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt
            }))
        });
    } catch (err) {
        next(err);
    }
});

// Create conversation
app.post("/api/chats", requireAuth, async(req, res, next) => {
    try {
        const chat = await Chat.create({
            userId: req.session.userId,
            title: "New conversation",
            messages: []
        });

        res.status(201).json({
            chat: {
                id: String(chat._id),
                title: chat.title,
                messages: []
            }
        });
    } catch (err) {
        next(err);
    }
});

// Read one conversation
app.get("/api/chats/:id", requireAuth, async(req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                error: "Invalid conversation ID."
            });
        }

        const chat = await Chat.findOne({
            _id: req.params.id,
            userId: req.session.userId
        }).lean();

        if (!chat) {
            return res.status(404).json({
                error: "Conversation not found."
            });
        }

        res.json({
            chat: {
                id: String(chat._id),
                title: chat.title,
                messages: chat.messages
            }
        });
    } catch (err) {
        next(err);
    }
});

// Delete conversation
app.delete("/api/chats/:id", requireAuth, async(req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                error: "Invalid conversation ID."
            });
        }

        const result = await Chat.deleteOne({
            _id: req.params.id,
            userId: req.session.userId
        });

        if (!result.deletedCount) {
            return res.status(404).json({
                error: "Conversation not found."
            });
        }

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// Send message to AI
app.post(
    "/api/chats/:id/messages",
    requireAuth,
    messageLimiter,
    async(req, res, next) => {
        try {
            if (!ai) {
                return res.status(503).json({
                    error: "AI is not configured. Add GROQ_API_KEY to .env and restart the server."
                });
            }

            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({
                    error: "Invalid conversation ID."
                });
            }

            const message =
                typeof req.body.message === "string" ?
                req.body.message.trim() :
                "";

            if (!message || message.length > 12000) {
                return res.status(400).json({
                    error: "Message must be between 1 and 12,000 characters."
                });
            }

            const chat = await Chat.findOne({
                _id: req.params.id,
                userId: req.session.userId
            });

            if (!chat) {
                return res.status(404).json({
                    error: "Conversation not found."
                });
            }

            const history = chat.messages.slice(-20).map((item) => ({
                role: item.role,
                content: item.content
            }));

            // Save the user's message first.
            chat.messages.push({
                role: "user",
                content: message
            });

            if (chat.title === "New conversation") {
                chat.title =
                    message.length > 60 ?
                    message.slice(0, 57) + "..." :
                    message;
            }

            await chat.save();

            try {
                const result = await ai.chat.completions.create({
                    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
                    messages: [{
                            role: "system",
                            content: "You are Nexora, a helpful, clear, friendly AI assistant. Answer accurately, admit uncertainty, and format explanations so they are easy to read."
                        },
                        ...history,
                        { role: "user", content: message }
                    ],
                    max_completion_tokens: 1200
                });

                const answer =
                    result.choices?.[0]?.message?.content?.trim() || "";

                if (!answer) {
                    console.error(
                        "Groq returned no text:",
                        JSON.stringify(result)
                    );

                    return res.status(502).json({
                        error: "The AI returned an empty response. Please try again."
                    });
                }

                // Save the AI response.
                chat.messages.push({
                    role: "assistant",
                    content: answer
                });

                await chat.save();

                return res.json({
                    message: answer,
                    chat: {
                        id: String(chat._id),
                        title: chat.title,
                        messages: chat.messages
                    }
                });
            } catch (err) {
                console.error("Groq request failed:", err.message);

                return res.status(502).json({
                    error: "Nexora could not get a response from the AI provider. Please try again."
                });
            }
        } catch (err) {
            next(err);
        }
    }
);

// Unknown API routes
app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
});

// Error handler
app.use((err, _req, res, _next) => {
    console.error(err);

    if (res.headersSent) return;

    res.status(500).json({
        error: "Something went wrong. Please try again."
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Nexora running at http://localhost:${PORT}`);
});
