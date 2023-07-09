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
  // owner token mint params
  let owners = [];
  let percentages = [6000, 4000];

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
    owners = [paymentsOwner.address, collectionOwner.address];
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(TOKEN_ID, owners, percentages);

    // set price to access a token
    await setPriceOfAccess(accessNFT, collectionOwner, TOKEN_ID, ACCESS_COST);
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

    const amountRedeemable = await pf.getWithdrawableBalance(
      paymentsOwner.address,
      TOKEN_ID
    );

    const percentage =
      percentages[
        owners.findIndex((address) => address === paymentsOwner.address)
      ] / 10000;

    const expectedAmount = ACCESS_COST * percentage;

    expect(amountRedeemable).to.equal(expectedAmount);

    await pf.connect(paymentsOwner).withdraw(TOKEN_ID);
    const paymentOwnerBalancePostWithdraw = await stableCoin.balanceOf(
      paymentsOwner.address
    );

    expect(paymentOwnerBalancePostWithdraw).to.equal(expectedAmount);

    const amountRedeemablePostWithdraw = await pf.getWithdrawableBalance(
      paymentsOwner.address,
      TOKEN_ID
    );

    expect(amountRedeemablePostWithdraw).to.equal(0);
    const pmBalancePostWithdraw = await stableCoin.balanceOf(pm.address);
    expect(pmBalancePostWithdraw.toNumber()).to.equal(
      ACCESS_COST - expectedAmount
    );
  });

  it("reverts if the withdrawing account is not an owner of any token", async function () {
    // the withdrawing account must own the tokenId on the Owners NFT (not the collection NFT)
    await expect(pf.connect(admin).withdraw(TOKEN_ID)).to.be.revertedWith(
      "PaymentFacilitator: zero-withdrawable-amount"
    );
  });

  it("reverts if the redeemable balance is 0", async function () {
    // no payment has been made
    await expect(
      pf.connect(paymentsOwner).withdraw(TOKEN_ID)
    ).to.be.revertedWith("PaymentFacilitator: zero-withdrawable-amount");
  });

  it("reverts when trying to deactivate facilitator with an account balance on the PaymentManager", async function () {
    // make a payment to transfer funds to the PaymentManager contract
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const pmBalance = await stableCoin.balanceOf(pm.address);
    expect(pmBalance.toNumber() > 0).to.equal(true);

    await expect(
      pm.connect(admin).setFacilitator(pf.address, false)
    ).to.be.revertedWith("PaymentManager: non-zero-facilitator-balance");
  });
});
