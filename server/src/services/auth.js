import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id || user.id), email: user.email, orgId: user.orgId, role: user.role },
    config.auth.secret,
    { expiresIn: config.auth.tokenTtl }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.secret);
  } catch {
    return null;
  }
}
