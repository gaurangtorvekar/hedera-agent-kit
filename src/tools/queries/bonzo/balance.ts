import { Client, ContractCallQuery, ContractId, AccountId } from "@hashgraph/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { HederaMirrorNodeClient } from "../../../tests/utils/hederaMirrorNodeClient";
import { NetworkType as MirrorNodeNetworkType } from "../../../tests/types";
import { ethers } from "ethers";

export interface BonzoTokenInfo {
  token: {
    address: string;
  };
  aToken: {
    address: string;
  };
  stableDebt: {
    address: string;
  };
  variableDebt: {
    address: string;
  };
}

export interface BonzoNetworkContracts {
  [tokenSymbol: string]: {
    hedera_testnet?: BonzoTokenInfo;
    hedera_mainnet?: BonzoTokenInfo;
  };
}

export interface BonzoCoreContract {
  hedera_testnet?: {
    address: string;
    deployer?: string;
  };
  hedera_mainnet?: {
    address: string;
    deployer?: string;
  };
}

interface BonzoContractsConfig {
  [key: string]: BonzoNetworkContracts | BonzoCoreContract;
}

/**
 * Load Bonzo contracts configuration
 */
function loadBonzoContracts(): BonzoContractsConfig {
  try {
    const configPath = join(__dirname, "..", "..", "..", "config", "bonzo-contracts.json");
    const configData = readFileSync(configPath, "utf-8");
    return JSON.parse(configData) as BonzoContractsConfig;
  } catch (error) {
    throw new Error(`Failed to load Bonzo contracts configuration: ${error}`);
  }
}

/**
 * Map network names to the format used in contracts
 */
function mapNetworkName(network: "mainnet" | "testnet" | "previewnet"): string {
  switch (network) {
    case "mainnet":
      return "hedera_mainnet";
    case "testnet":
      return "hedera_testnet";
    case "previewnet":
      return "hedera_testnet"; // Fallback to testnet for previewnet
    default:
      return "hedera_testnet";
  }
}

/**
 * Get available token symbols from the contracts
 */
export function getAvailableTokens(): string[] {
  const contracts = loadBonzoContracts();
  const tokens: string[] = [];

  for (const [key, value] of Object.entries(contracts)) {
    // Check if this is a token (has aToken property in network configs)
    if (typeof value === "object" && value !== null) {
      const networks = Object.values(value);
      if (networks.some((network) => network && typeof network === "object" && "aToken" in network)) {
        tokens.push(key);
      }
    }
  }

  return tokens;
}

/**
 * Get token information for a specific asset and network
 */
export function getTokenInfo(network: "mainnet" | "testnet" | "previewnet", assetSymbol: string): BonzoTokenInfo | null {
  const contracts = loadBonzoContracts();
  const networkKey = mapNetworkName(network);

  // Try exact match first
  if (contracts[assetSymbol]) {
    const tokenConfig = contracts[assetSymbol] as any;
    const networkConfig = tokenConfig[networkKey];
    if (networkConfig && networkConfig.aToken) {
      return networkConfig as BonzoTokenInfo;
    }
  }

  // Try case-insensitive match
  for (const [symbol, tokenConfig] of Object.entries(contracts)) {
    if (symbol.toLowerCase() === assetSymbol.toLowerCase() && typeof tokenConfig === "object") {
      const networkContracts = tokenConfig as any;
      const networkConfig = networkContracts[networkKey];
      if (networkConfig && networkConfig.aToken) {
        return networkConfig as BonzoTokenInfo;
      }
    }
  }

  return null;
}

/**
 * Get core contract address (like LendingPool, PriceOracle, etc.)
 */
export function getCoreContractAddress(network: "mainnet" | "testnet" | "previewnet", contractName: string): string | null {
  const contracts = loadBonzoContracts();
  const networkKey = mapNetworkName(network);

  if (contracts[contractName]) {
    const contractConfig = contracts[contractName] as BonzoCoreContract;
    const networkConfig = contractConfig[networkKey as keyof typeof contractConfig];
    if (networkConfig && "address" in networkConfig) {
      return networkConfig.address;
    }
  }

  return null;
}

/**
 * Get aToken balance for a given account using ethers.js
 */
export async function get_bonzo_atoken_balance(
  client: Client,
  network: "mainnet" | "testnet" | "previewnet",
  assetSymbol: string,
  accountId: string
): Promise<{ balance: string; symbol: string; decimals: number }> {
  const tokenInfo = getTokenInfo(network, assetSymbol);

  if (!tokenInfo || !tokenInfo.aToken?.address) {
    throw new Error(`aToken not found for asset: ${assetSymbol} on network: ${network}`);
  }

  // Minimal ABI for ERC20 balanceOf and decimals
  const erc20Abi = ["function balanceOf(address account) view returns (uint256)", "function decimals() view returns (uint8)"];

  try {
    // Initialize MirrorNodeClient
    const mirrorNodeNetwork = network as MirrorNodeNetworkType;
    const mirrorNodeClient = new HederaMirrorNodeClient(mirrorNodeNetwork);

    // Get account info from mirror node to retrieve EVM address
    const accountInfo = await mirrorNodeClient.getAccountInfo(accountId);
    if (!accountInfo || !accountInfo.evm_address) {
      throw new Error(`Could not retrieve EVM address for account ${accountId} from mirror node.`);
    }
    // The user's EVM address, ensure it has 0x prefix for ethers.js
    const userEvmAddress = accountInfo.evm_address.startsWith("0x") ? accountInfo.evm_address : `0x${accountInfo.evm_address}`;

    // Set up ethers provider based on network
    let rpcUrl;
    if (network === "mainnet") {
      rpcUrl = "https://mainnet.hashio.io/api";
    } else {
      // testnet or previewnet
      rpcUrl = "https://testnet.hashio.io/api";
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Create contract instance
    const aTokenContract = new ethers.Contract(tokenInfo.aToken.address, erc20Abi, provider);

    // Call balanceOf
    const balanceBigInt = await aTokenContract.balanceOf(userEvmAddress);
    const balance = balanceBigInt.toString();

    // Call decimals
    const decimalsBigInt = await aTokenContract.decimals();
    const decimals = Number(decimalsBigInt); // Convert BigNumberish to number

    return {
      balance,
      symbol: `a${assetSymbol}`,
      decimals,
    };
  } catch (error: any) {
    // Consolidate error message
    let errorMessage = `Failed to get aToken balance for ${assetSymbol} using ethers.js`;
    if (error.message) {
      errorMessage += `: ${error.message}`;
    }
    if (error.data?.message) {
      // Check for nested error messages from RPC calls
      errorMessage += ` - RPC Error: ${error.data.message}`;
    }
    // For more detailed debugging, one might want to log the full error object
    // console.error("Ethers.js call failed:", error);
    throw new Error(errorMessage);
  }
}

/**
 * Format balance according to token decimals
 */
export function formatBalance(balance: string, decimals: number): string {
  const balanceBigInt = BigInt(balance);
  const divisor = BigInt(10 ** decimals);

  const integerPart = balanceBigInt / divisor;
  const fractionalPart = balanceBigInt % divisor;

  if (fractionalPart === BigInt(0)) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
  const trimmedFractional = fractionalStr.replace(/0+$/, "");

  if (trimmedFractional === "") {
    return integerPart.toString();
  }

  return `${integerPart}.${trimmedFractional}`;
}

/**
 * Get user account data from Bonzo lending pool
 */
export async function get_bonzo_user_account_data(
  client: Client,
  network: "mainnet" | "testnet" | "previewnet",
  accountId: string
): Promise<{
  totalCollateralETH: string;
  totalDebtETH: string;
  availableBorrowsETH: string;
  currentLiquidationThreshold: string;
  ltv: string;
  healthFactor: string;
}> {
  const lendingPoolAddress = getCoreContractAddress(network, "LendingPool");

  if (!lendingPoolAddress) {
    throw new Error(`LendingPool contract not found for network: ${network}`);
  }

  try {
    // getUserAccountData(address user) function selector: 0xbf92857c
    const functionSelector = "bf92857c";

    // Encode the account ID parameter
    const accountIdBytes = AccountId.fromString(accountId).toSolidityAddress();
    const paddedAccountId = accountIdBytes.padStart(64, "0");

    const functionParameters = functionSelector + paddedAccountId;

    const contractCallQuery = new ContractCallQuery().setContractId(ContractId.fromEvmAddress(0, 0, lendingPoolAddress)).setFunctionParameters(Buffer.from(functionParameters, "hex")).setGas(100000);

    const contractCallResult = await contractCallQuery.execute(client);

    // Parse the result - getUserAccountData returns 6 uint256 values
    const resultBytes = Buffer.from(contractCallResult.bytes).toString("hex");

    // Each uint256 is 32 bytes (64 hex characters)
    const totalCollateralETH = BigInt(`0x${resultBytes.slice(0, 64)}`).toString();
    const totalDebtETH = BigInt(`0x${resultBytes.slice(64, 128)}`).toString();
    const availableBorrowsETH = BigInt(`0x${resultBytes.slice(128, 192)}`).toString();
    const currentLiquidationThreshold = BigInt(`0x${resultBytes.slice(192, 256)}`).toString();
    const ltv = BigInt(`0x${resultBytes.slice(256, 320)}`).toString();
    const healthFactor = BigInt(`0x${resultBytes.slice(320, 384)}`).toString();

    return {
      totalCollateralETH,
      totalDebtETH,
      availableBorrowsETH,
      currentLiquidationThreshold,
      ltv,
      healthFactor,
    };
  } catch (error: any) {
    throw new Error(`Failed to get user account data: ${error.message}`);
  }
}
