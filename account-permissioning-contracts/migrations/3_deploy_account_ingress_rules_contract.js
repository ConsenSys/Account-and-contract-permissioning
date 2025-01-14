const fs = require('fs');

const Web3Utils = require("web3-utils");
const AllowlistUtils = require('../scripts/allowlist_utils');

const Rules = artifacts.require("./AccountRules.sol");
const AccountIngress = artifacts.require("./AccountIngress.sol");
const Admin = artifacts.require("./Admin.sol");
const AccountStorage = artifacts.require("./AccountStorage.sol");

const adminContractName = Web3Utils.utf8ToHex("administration");
const rulesContractName = Web3Utils.utf8ToHex("rules");

/* The address of the account ingress contract if pre-deployed */
let accountIngress = process.env.ACCOUNT_INGRESS_CONTRACT_ADDRESS;
/* The address of the account storage contract if pre-deployed */
let accountStorage = process.env.ACCOUNT_STORAGE_CONTRACT_ADDRESS;
let retainCurrentRulesContract = AllowlistUtils.getRetainAccountRulesContract();

async function logCurrentAllowlist(instance) {
    let currentAllowlist = await instance.getAccounts();
    console.log("\n<<< current ACCOUNT allowlist >>>");
    console.log(currentAllowlist);
    console.log("\n<<< end of current ACCOUNT allowlist >>>");
}
module.exports = async(deployer, network) => {
    // exit early if we are NOT redeploying this contract
    if (retainCurrentRulesContract) {
        console.log("not deploying AccountRules because retain=" + retainCurrentRulesContract);
        logCurrentAllowlist(await Rules.deployed());
        return;
    }
    if (! accountIngress) {
        // Only deploy if we haven't been provided a pre-deployed address
        await deployer.deploy(AccountIngress);
        console.log("   > Deployed AccountIngress contract to address = " + AccountIngress.address);
        accountIngress = AccountIngress.address;

    }
    // If supplied an address, make sure there's something there
    const accountIngressInstance = await AccountIngress.at(accountIngress);
    try {
        const result = await accountIngressInstance.getContractVersion();
        console.log("   > AccountIngress contract initialised at address = " + accountIngress + " version=" + result);
    } catch (err) {
        console.log(err);
        console.error("   > Predeployed AccountIngress contract is not responding like an AccountIngress contract at address = " + accountIngress);
    }

    const admin = await Admin.deployed();
    await accountIngressInstance.setContractAddress(adminContractName, admin.address);
    console.log("   > Updated AccountIngress with Admin address = " + admin.address);

    // STORAGE
    var storageInstance;
    if (! accountStorage) {
        // Only deploy if we haven't been provided a pre-deployed address
        storageInstance = await deployer.deploy(AccountStorage, accountIngress);
        console.log("   > Deployed AccountStorage contract to address = " + AccountStorage.address);
        accountStorage = AccountStorage.address;
    } else {
        // is there a storage already deployed
        storageInstance = await AccountStorage.at(accountStorage);
        console.log(">>> Using existing AccountStorage " + storageInstance.address);
        // TODO check that this contract is a storage contract eg call a method
    }

    // rules -> storage
    await deployer.deploy(Rules, accountIngress, accountStorage);
    console.log("   > Rules deployed with AccountIngress.address = " + accountIngress + "\n   > and storageAddress = " + accountStorage);
    let accountRulesContract = await Rules.deployed();
    fs.appendFileSync('../contracts.env', 'export CONTRACT_ACCOUNT_RULES=' + accountRulesContract.address + '\n');

    // storage -> rules
    await storageInstance.upgradeVersion(Rules.address);
    console.log("   >>> Set storage owner to Rules.address " + Rules.address);

    let createdOrMigratedAccounts;
    if (AllowlistUtils.isInitialAllowlistedAccountsAvailable()) {
        console.log("   > Adding Initial Allowlisted Accounts ...");
        createdOrMigratedAccounts = AllowlistUtils.getInitialAllowlistedAccounts();
        if (createdOrMigratedAccounts.length > 0) {
            await accountRulesContract.addAccounts(allowlistedAccounts);
            console.log ("   > Initial Allowlisted Accounts added: " + allowlistedAccounts);
        }
    }else{
        createdOrMigratedAccounts = await accountRulesContract.getAccounts();
    }

    // set these accounts to be able to deploy contracts
    for (const account of createdOrMigratedAccounts) {
        await accountRulesContract.setCreateContractPermission(account, true);
        console.log(">>> gave contract creation permission to " + account);
    }

    await accountIngressInstance.setContractAddress(rulesContractName, Rules.address);
    console.log("   > Updated AccountIngress contract with Rules address = " + Rules.address);

    logCurrentAllowlist(accountRulesContract);
}
