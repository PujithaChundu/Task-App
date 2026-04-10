const jwt = require("jsonwebtoken");

const { getUserById } = require("./data");

const COOKIE_NAME = "task_manager_token";
const TOKEN_LIFETIME = "7d";
const cookieConfig = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function getSecret() {
  return process.env.JWT_SECRET || "replace-this-secret-before-production";
}

function sanitizeUser(userRow, departmentName = "Unassigned") {
  if (!userRow) {
    return null;
  }

  return {
    id: userRow.id,
    fullName: userRow.full_name,
    username: userRow.username,
    role: userRow.role,
    departmentId: userRow.department_id,
    departmentName,
    isActive: Boolean(userRow.is_active),
  };
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    getSecret(),
    { expiresIn: TOKEN_LIFETIME }
  );
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, createToken(user), cookieConfig);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieConfig);
}

async function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    next();
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, getSecret());
  } catch (_error) {
    req.user = null;
    next();
    return;
  }

  try {
    const userRow = await getUserById(payload.id);

    if (userRow && userRow.is_active) {
      req.user = sanitizeUser(userRow);
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  next();
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required." });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "You do not have access to this action." });
      return;
    }

    next();
  };
}

module.exports = {
  attachUser,
  authorizeRoles,
  clearAuthCookie,
  requireAuth,
  sanitizeUser,
  setAuthCookie,
};
