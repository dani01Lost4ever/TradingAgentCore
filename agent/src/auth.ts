import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { UserModel } from './schema'

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'
const JWT_EXPIRY = '7d'

export function signToken(username: string): string {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: JWT_EXPIRY })
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string }
  } catch {
    return null
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!verifyToken(header.slice(7))) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }
  next()
}

// Called once after connectDB() to create the default admin if none exists
export async function ensureAdminExists(): Promise<void> {
  const existing = await UserModel.findOne({ username: 'admin' })
  if (!existing) {
    const password = process.env.ADMIN_PASSWORD || 'admin'
    const passwordHash = await bcrypt.hash(password, 10)
    await UserModel.create({ username: 'admin', passwordHash })
    console.log(`[auth] Created default admin user (password: ${password === 'admin' ? 'admin — set ADMIN_PASSWORD env to change' : '****'})`)
  }
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' })
    return
  }
  const user = await UserModel.findOne({ username })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }
  res.json({ token: signToken(username) })
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'currentPassword and newPassword (min 6 chars) required' })
    return
  }
  const user = await UserModel.findOne({ username: 'admin' })
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: 'Current password incorrect' })
    return
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10)
  await user.save()
  res.json({ success: true })
}
