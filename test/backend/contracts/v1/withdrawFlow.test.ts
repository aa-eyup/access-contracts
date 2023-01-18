import assert from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts/lib/index";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  deployContracts,
  deployContentContract,
  deployPaymentManager,
  deployStableCoin,
  setPriceOfAccess,
} from "./utils";
import { AccessTypes, NftType } from "./types";

describe("Withdraw Flow", function () {
  const TOKEN_ID = 132;
  const INITIAL_PAYER_BALANCE = 1000000000;
  const ACCESS_COST = 100;
  // accounts
  let admin: SignerWithAddress;
  let payer: SignerWithAddress;
  let collectionOwner: SignerWithAddress;
  let paymentsOwner: SignerWithAddress;
  let accessor: SignerWithAddress;
  // contracts
  let pm: Contract;
  let pf: Contract;
  let config: Contract;
  let accessNFT: Contract;
  let ownersNFT: Contract;
  let stableCoin: Contract;
  let contentContract: Contract;

  before(async function () {
    [admin, payer, collectionOwner, paymentsOwner, accessor] =
      await ethers.getSigners();

    stableCoin = await deployStableCoin(payer.address, INITIAL_PAYER_BALANCE);

    // sets the collection owner address as the owner of the TOKEN_ID token
    contentContract = await deployContentContract(
      collectionOwner.address,
      TOKEN_ID,
      NftType.ERC721
    );
    assert(contentContract, "failed to deploy content contract");

    pm = await deployPaymentManager(admin.address, stableCoin.address);
    const contracts = await deployContracts({
      adminSigner: admin,
      paymentManagerContract: pm,
      contentAddress: contentContract.address,
    });
    pf = contracts.paymentFacilitator;
    config = contracts.config;
    accessNFT = contracts.accessNFT;
    ownersNFT = contracts.ownersNFT;

    // approve the payer on the Payment Manager so that the PM can pull funds
    await stableCoin.connect(payer).approve(pm.address, INITIAL_PAYER_BALANCE);

    // set owner of a token content contract
    await ownersNFT
      .connect(collectionOwner)
      .setOwner(TOKEN_ID, paymentsOwner.address);

    // set price to access a token
    await setPriceOfAccess(accessNFT, paymentsOwner, TOKEN_ID, ACCESS_COST);
  });

  it("log deployed addresses", async function () {
    console.log("PaymentManager address: ", pm.address);
    console.log("PaymentFacilitator address: ", pf.address);
    console.log("Config address: ", config.address);
    console.log("Access NFT address: ", accessNFT.address);
  });

  it("funds are transferred from the PaymentManager contract to the owner", async function () {
    // make a payment to transfer funds to the PaymentManager contract
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const pmBalance = await stableCoin.balanceOf(pm.address);
    expect(pmBalance.toNumber()).to.equal(ACCESS_COST);
    const paymentOwnerBalance = await stableCoin.balanceOf(
      paymentsOwner.address
    );
    expect(paymentOwnerBalance).to.equal(0);

    const amountRedeemable = await pf.getOwnerBalance(paymentsOwner.address);
    expect(amountRedeemable).to.equal(ACCESS_COST);

    // withdraw the funds as the account which was set as the "paymentsOwner" for 1 or more tokens
    await pf.connect(paymentsOwner).withdraw();
    const paymentOwnerBalancePostWithdraw = await stableCoin.balanceOf(
      paymentsOwner.address
    );
    expect(paymentOwnerBalancePostWithdraw).to.equal(ACCESS_COST);
    const amountRedeemablePostWithdraw = await pf.getOwnerBalance(
      paymentsOwner.address
    );
    expect(amountRedeemablePostWithdraw).to.equal(0);
    const pmBalancePostWithdraw = await stableCoin.balanceOf(pm.address);
    expect(pmBalancePostWithdraw.toNumber()).to.equal(0);
  });

  it("reverts if the withdrawing account is an owner of any token", async function () {
    // the withdrawing account must own the tokenId on the Owners NFT (not the collection NFT)
    await expect(pf.connect(collectionOwner).withdraw()).to.be.revertedWith(
      "Withdrawal error: 0 funds available"
    );
  });

  it("reverts if the redeemable balance is 0", async function () {
    // no payment has been made
    await expect(pf.connect(paymentsOwner).withdraw()).to.be.revertedWith(
      "Withdrawal error: 0 funds available"
    );
  });

  it("reverts when trying to deactivate facilitator with an account balance on the PaymentManager", async function () {
    // make a payment to transfer funds to the PaymentManager contract
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const pmBalance = await stableCoin.balanceOf(pm.address);
    expect(pmBalance.toNumber()).to.equal(ACCESS_COST);

    await expect(
      pm.connect(admin).setFacilitator(pf.address, false)
    ).to.be.revertedWith(
      "unable to deactivate a facilitator with a non-zero balance on the PaymentManager"
    );
  });
});
