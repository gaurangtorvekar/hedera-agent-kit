import { Tool } from "@langchain/core/tools";
import HederaAgentKit from "../../../agent";

export class BonzoGetATokenBalanceTool extends Tool {
  name = "bonzo_get_atoken_balance";

  description = `Retrieves the aToken balance for a specified asset on Bonzo finance protocol.  
aTokens are interest-bearing tokens that represent deposits in the Bonzo lending protocol.
If an account ID is provided, it returns the aToken balance of that account.  
If no account ID is given, it returns the aToken balance of the connected account.  

### **Inputs** (input is a JSON string):  
- **asset** (*string*, required): The asset symbol to check aToken balance for.  
  - Supported assets: "USDC", "HBARX", "SAUCE", "XSAUCE", "KARATE", "HBAR", "GRELF", "KBL", "BONZO", "DOVU", "HST", "PACK", "STEAM"
- **accountId** (*string*, optional): The Hedera account ID to check the balance for (e.g., "0.0.789012").  
  - If omitted, the tool will return the balance of the connected account.  

### **Example Usage:**  
1. **Get supply balance for USDC:**  
   '{ "asset": "USDC", "accountId": "0.0.123456" }'  
2. **Get supply balance for HBARX balance of the connected account:**  
   '{ "asset": "HBARX" }'
3. **Get supply balance for SAUCE balance for an account:**  
   '{ "asset": "SAUCE", "accountId": "0.0.123456" }'

### **Returns:**
- Raw balance (in smallest unit, typically 8 decimals)
- Formatted balance (human-readable)
- aToken symbol (e.g., "aUSDC", "aHBARX")
- Decimals (6 or8 for most tokens)

### **Available Networks:**
- Mainnet: Real Bonzo Finance contracts
- Testnet: Bonzo Finance testnet contracts
- Previewnet: Falls back to testnet contracts
`;

  constructor(private hederaKit: HederaAgentKit) {
    super();
  }

  protected async _call(input: string): Promise<string> {
    try {
      console.log("bonzo_get_atoken_balance tool has been called");

      const parsedInput = JSON.parse(input);

      if (!parsedInput.asset) {
        return JSON.stringify({
          status: "error",
          message: "Asset parameter is required",
          code: "MISSING_ASSET_PARAMETER",
        });
      }

      const result = await this.hederaKit.getBonzoATokenBalance(parsedInput.asset, parsedInput?.accountId);

      return JSON.stringify({
        status: "success",
        asset: parsedInput.asset,
        accountId: parsedInput?.accountId || this.hederaKit.accountId,
        aToken: {
          symbol: result.symbol,
          balance: result.balance,
          formattedBalance: result.formattedBalance,
          decimals: result.decimals,
        },
        protocol: "Bonzo Finance",
        network: this.hederaKit.network,
      });
    } catch (error: any) {
      return JSON.stringify({
        status: "error",
        message: error.message,
        code: error.code || "UNKNOWN_ERROR",
      });
    }
  }
}
