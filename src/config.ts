import dotenv from "dotenv";

dotenv.config();

export const PORT = parseInt(process.env.PORT || "8090", 10);

// CDP Configuration (preferred)
export const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
export const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;
export const CDP_WALLET_SECRET = process.env.CDP_WALLET_SECRET;

// Legacy private key configuration (fallback)
export const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
export const SVM_PRIVATE_KEY = process.env.SVM_PRIVATE_KEY;

// RPC URLs
export const EVM_RPC_URL_BASE = process.env.EVM_RPC_URL_BASE;
export const EVM_RPC_URL_BASE_SEPOLIA = process.env.EVM_RPC_URL_BASE_SEPOLIA;

// Determine which signer mode to use
export const USE_CDP = !!(CDP_API_KEY_ID && CDP_API_KEY_SECRET && CDP_WALLET_SECRET);
export const USE_PRIVATE_KEY = !!(EVM_PRIVATE_KEY && SVM_PRIVATE_KEY);

// Validate configuration
if (!USE_CDP && !USE_PRIVATE_KEY) {
  console.error("❌ Missing signer configuration. Provide either:");
  console.error("   CDP: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET");
  console.error("   Or private keys: EVM_PRIVATE_KEY, SVM_PRIVATE_KEY");
  process.exit(1);
}

if (USE_CDP) {
  console.info("✅ Using CDP signer");
} else {
  console.info("✅ Using private key signer");
}
