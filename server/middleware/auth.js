const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "interverse-dev-secret-change-me";

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, {
    expiresIn: "30d",
  });
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired — sign in again" });
  }
}

module.exports = { sign, requireAuth };
