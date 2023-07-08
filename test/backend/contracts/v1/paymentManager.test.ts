import assert from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts/lib/index";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { deployPaymentManager, deployStableCoin } from "./utils";

describe("Payment Manager", function () {
  const INITIAL_PAYER_BALANCE = 1000000000;
  // accounts
  let admin: SignerWithAddress;
  let payer: SignerWithAddress;
  let collectionOwner: SignerWithAddress;
  let paymentsOwner: SignerWithAddress;
  let secondAdmin: SignerWithAddress;
  // contracts
  let pm: Contract;
  let stableCoin: Contract;

  const pauseAndUnpause = async (account: SignerWithAddress) => {
    expect(await pm.paused()).to.equal(false);
    await pm.connect(account).pause();
    expect(await pm.paused()).to.equal(true);
    await pm.connect(account).unpause();
    expect(await pm.paused()).to.equal(false);
  };

  const testStableCoinSet = async (account: SignerWithAddress) => {
    const newAddress = "0xB8Cd93C83A974649D76B1c19f311f639e62272BC";
    // this would revert if account does not have admin permissions
    await pm.connect(account).setStableCoin(newAddress);
    await pm.connect(account).setStableCoin(stableCoin.address);
  };

  before(async function () {
    [admin, payer, collectionOwner, paymentsOwner, secondAdmin] =
      await ethers.getSigners();
    stableCoin = await deployStableCoin(payer.address, INITIAL_PAYER_BALANCE);
    pm = await deployPaymentManager(admin.address, stableCoin.address);
  });

  it("should set the stable coin if msg sender is an admin", async () => {
    await testStableCoinSet(admin);
  });

  it("should pause the PM if msg sender is an admin", async () => {
    await pauseAndUnpause(admin);
  });

  it("should add another admin is msg sender is an existing admin", async () => {
    await pm.connect(admin).grantAdminRole(secondAdmin.address);
    // should now be able to perform an action that only an admin can
    await testStableCoinSet(secondAdmin);
  });

  it("should revoke admin permissions from an account if msg sender is an existing admin", async () => {
    await pm.connect(secondAdmin).revokeAdminRole(admin.address);
    // test performing an admin role action
    await expect(
      pm
        .connect(admin)
        .setStableCoin("0xB8Cd93C83A974649D76B1c19f311f639e62272BC")
    ).to.be.revertedWith("Must have admin role to perform this action");
    await pm.connect(secondAdmin).grantAdminRole(admin.address);
  });

  it("should fail to set stable coin if msg sender is not admin", async () => {
    const newAddress = "0xB8Cd93C83A974649D76B1c19f311f639e62272BC";
    await expect(
      pm.connect(collectionOwner).setStableCoin(newAddress)
    ).to.be.revertedWith("Must have admin role to perform this action");
  });

  it("should fail to pause PM if msg sender is not permitted", async () => {
    expect(await pm.paused()).to.equal(false);
    await expect(pm.connect(collectionOwner).pause()).to.be.rejectedWith(
      "Must have pauser role to perform this action"
    );
    expect(await pm.paused()).to.equal(false);
  });
});
