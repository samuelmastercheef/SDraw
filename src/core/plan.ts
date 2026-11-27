/**
 * Gói dịch vụ khi liên kết tài khoản Socin. Dùng chung cho app và máy chủ.
 * Chế độ ngoại tuyến không cần gói: mọi tính năng dựng hình, bản vẽ, xuất file, cổng AI cục bộ luôn mở.
 * Cổng thanh toán (sau này) chỉ cần ghi gói và hạn dùng cho doanh nghiệp; phần còn lại đọc từ đây.
 */
export type PlanId = 'free' | 'pro'

export interface PlanLimits {
  /** Số mô hình lưu trên Socin của mỗi doanh nghiệp */
  cloudModels: number
  /** Dung lượng tối đa một mô hình (byte) */
  cloudModelBytes: number
  /** Số gói kèm file đăng lên Store */
  storeFiles: number
}

export const PLANS: Record<PlanId, { name: string; limits: PlanLimits }> = {
  free: { name: 'Miễn phí', limits: { cloudModels: 20, cloudModelBytes: 10 * 1024 * 1024, storeFiles: 10 } },
  pro: { name: 'Pro', limits: { cloudModels: 1000, cloudModelBytes: 20 * 1024 * 1024, storeFiles: 100 } }
}

export const isPlanId = (x: unknown): x is PlanId => x === 'free' || x === 'pro'

/** Gói còn hiệu lực: hết hạn thì về miễn phí. */
export function effectivePlan(plan: unknown, expiresAt: number | null | undefined, now: number): PlanId {
  if (!isPlanId(plan) || plan === 'free') return 'free'
  return expiresAt == null || expiresAt > now ? plan : 'free'
}

export interface PlanInfo {
  plan: PlanId
  name: string
  expiresAt: number | null
  limits: PlanLimits
  usage: { cloudModels: number; storeFiles: number }
}
