import { AuditLogModel } from './schema'
import { Request } from 'express'

export async function logAudit(
  action: string,
  details: string,
  user = 'admin',
  req?: Request
): Promise<void> {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '') : ''
    await AuditLogModel.create({ action, details, user, ip })
  } catch { /* never throw from audit */ }
}
