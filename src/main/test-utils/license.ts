import type { HandlerServices } from '../ipc/ipc-safe';

/** A licence service that refuses nothing and never reaches a server (tests of other channels). */
export function allowAllLicense(): HandlerServices['license'] {
  const status = async () => ({
    mode: 'full' as const,
    reason: 'unlimited' as const,
    linked: true,
    storeId: '1000',
    storeName: 'Test',
    plan: 'VIP' as const,
    features: [],
    daysLeft: null,
    expiresAt: null,
    trialEndsAt: null,
    lastCheckinAt: null,
    checkinBy: null,
    terminalId: 'test-till',
    lastError: null,
    payment: {
      supportPhone: '998712000000',
      paymentUrl: 'https://pay.example/1000',
      qrPayload: 'QR',
      card: { number: '9860123412341234', holder: 'EGASI', image: null },
    },
    account: {
      balance: '-75000',
      monthlyFee: '75000',
      nextChargeAt: null,
      owed: '75000',
      asOf: new Date(0).toISOString(),
      movements: [],
    },
  });
  const offline = async (): Promise<never> => {
    throw new Error('no server in tests');
  };
  return {
    refusal: async () => null,
    isLinked: () => true,
    isSetupMode: async () => false,
    status,
    checkNow: status,
    plans: async () => ({
      trial: { enabled: true, days: 14 },
      checkinDays: 14,
      plans: [],
      extraTerminalPrice: 0,
      supportPhone: '',
    }),
    signupStart: async () => ({
      verificationId: 'v1',
      botLink: null,
      expiresAt: new Date(0).toISOString(),
    }),
    signupStatus: async () => ({ contactConfirmed: false, expired: false }),
    signupComplete: offline,
    activate: offline,
  };
}
