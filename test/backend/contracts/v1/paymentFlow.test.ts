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

describe("Pay for Access Flow", function () {
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
  let contentContract721: Contract;
  // owner token mint params
  let owners = [];
  let percentages = [6000, 4000];

  beforeEach(async function () {
    [admin, payer, collectionOwner, paymentsOwner, accessor] =
      await ethers.getSigners();

    stableCoin = await deployStableCoin(payer.address, INITIAL_PAYER_BALANCE);

    contentContract721 = await deployContentContract(
      collectionOwner.address,
      TOKEN_ID,
      NftType.ERC721
    );
    assert(contentContract721, "failed to deploy content contract");

    pm = await deployPaymentManager(admin.address, stableCoin.address);
    const contracts = await deployContracts({
      adminSigner: admin,
      paymentManagerContract: pm,
      contentAddress: contentContract721.address,
    });
    pf = contracts.paymentFacilitator;
    config = contracts.config;
    accessNFT = contracts.accessNFT;
    ownersNFT = contracts.ownersNFT;

    // approve the payer on the Payment Manager so that the PM can pull funds
    await stableCoin.connect(payer).approve(pm.address, INITIAL_PAYER_BALANCE);

    // set owner of a token content contract
    owners = [collectionOwner.address, paymentsOwner.address];
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

  it("funds are transferred from the payer to the PaymentManager contract", async function () {
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const payerBalance = await stableCoin.balanceOf(payer.address);
    const pmBalance = await stableCoin.balanceOf(pm.address);
    const sum = payerBalance.add(pmBalance);
    expect(pmBalance.toNumber()).to.equal(ACCESS_COST);
    expect(sum.toNumber()).to.equal(INITIAL_PAYER_BALANCE);
  });

  it("the accessor is the message sender if not specified", async function () {
    // check that the ERC1155 Access NFT is minted to the msg.sender
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const balanceOfAccessToken = await accessNFT.balanceOf(
      payer.address,
      TOKEN_ID
    );
    expect(balanceOfAccessToken).to.be.gt(0);
  });

  it("does not mint an ERC1155 on the Access NFT is the accessor already possesses same token Id", async function () {
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);
    // pay again
    await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);

    const balanceOfAccessToken = await accessNFT.balanceOf(
      payer.address,
      TOKEN_ID
    );
    expect(balanceOfAccessToken).to.equal(1);
  });

  it("pay for access for a third party account", async function () {
    // use a unique tokenId to ensure the payer does not also own a token
    const tokenId = 1001;
    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);
    const tx = await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    // check that the ERC1155 Access NFT is minted to the accessor's address
    const payerBalance = await accessNFT.balanceOf(payer.address, tokenId);
    expect(payerBalance).to.equal(0);
    const accessorBalance = await accessNFT.balanceOf(
      accessor.address,
      tokenId
    );
    expect(accessorBalance).to.equal(1);
  });

  it("successfully increments the amount redeemable by the owner through the PaymentFacilitator", async function () {
    const redeemableByOwnerBefore = await pf.getWithdrawableBalance(
      paymentsOwner.address,
      TOKEN_ID
    );
    const tx = await pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);
    const priceToAccess = await accessNFT.getPrice(TOKEN_ID);
    const redeemableByOwnerAfter = await pf.getWithdrawableBalance(
      paymentsOwner.address,
      TOKEN_ID
    );
    expect(priceToAccess).to.be.gt(0);
    expect(redeemableByOwnerAfter).to.be.gt(0);
    // payments owner has 40% stake so expect 40% of priceToAccess
    expect(redeemableByOwnerAfter.sub(redeemableByOwnerBefore)).to.equal(
      priceToAccess * 0.4
    );
  });

  it("successfully sets the timestamp of payment for the accessor on the Access NFT", async function () {
    // use a unique token to ensure the timestamp starts at 0
    const tokenId = 1002;
    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);
    const tx = await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    const previousPaymentTime = await accessNFT.getPreviousPaymentTime(
      tokenId,
      accessor.address
    );
    expect(previousPaymentTime).to.be.gt(0);

    await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    const updatedTime = await accessNFT.getPreviousPaymentTime(
      tokenId,
      accessor.address
    );
    expect(previousPaymentTime).to.be.lt(updatedTime);
  });

  it("successfully increments the supply of the token on the Access NFT", async function () {
    // use a unique token to ensure the timestamp starts at 0
    const tokenId = 1003;
    expect(await accessNFT.totalSupply(tokenId)).to.be.equal(0);

    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);
    const tx = await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);

    expect(await accessNFT.totalSupply(tokenId)).to.be.equal(1);
  });

  it("reverts if the token on the Access NFT has hit its supply cap", async function () {
    // use a unique token to ensure the timestamp starts at 0
    const tokenId = 1004;
    expect(await accessNFT.totalSupply(tokenId)).to.be.equal(0);

    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);

    await accessNFT.connect(collectionOwner).setSupplyLimit(tokenId, 1);

    const tx = await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);
    // pay for the payer account which would have a balance of 0
    await expect(
      pf.connect(payer).pay(tokenId, AccessTypes.HOURLY_VIEW)
    ).to.be.revertedWith("PaymentFacilitator: access-mint-failed");
  });

  it("reverts if trying to set supply cap of an Access NFT token below the current supply", async function () {
    // use a unique token to ensure the timestamp starts at 0
    const tokenId = 1005;
    expect(await accessNFT.totalSupply(tokenId)).to.be.equal(0);

    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);

    const tx = await pf
      .connect(payer)
      .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
    expect(tx).to.have.property("hash");
    expect(tx).to.have.property("to", pf.address);
    // pay for the payer account which would have a balance of 0
    await pf.connect(payer).pay(tokenId, AccessTypes.HOURLY_VIEW);

    await expect(
      accessNFT.connect(collectionOwner).setSupplyLimit(tokenId, 1)
    ).to.be.revertedWith("Access: limit-below-current-supply");
  });

  it("fails to set supply limit if caller is not owner/approved on content", async function () {
    // use a unique token to ensure the timestamp starts at 0
    const tokenId = 1006;
    expect(await accessNFT.totalSupply(tokenId)).to.be.equal(0);

    await contentContract721.mint(collectionOwner.address, tokenId);
    await ownersNFT
      .connect(collectionOwner)
      .setOwners(tokenId, owners, percentages);
    await setPriceOfAccess(accessNFT, collectionOwner, tokenId, ACCESS_COST);

    await expect(
      accessNFT.connect(paymentsOwner).setSupplyLimit(tokenId, 1)
    ).to.be.revertedWith("Access: must-be-content-owner-or-approved");
  });

  it("reverts when the paying account does not have enough funds for access", async function () {
    const balance = await stableCoin.balanceOf(payer.address);
    await stableCoin.connect(payer).approve(pm.address, 1000000000000);
    const newPrice = balance + 1;
    await setPriceOfAccess(accessNFT, collectionOwner, TOKEN_ID, newPrice);
    await expect(
      pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW)
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  });

  it("reverts when the PaymentManager contract is not approved to access enough funds", async function () {
    const newPrice = 1000000000000;
    await setPriceOfAccess(accessNFT, collectionOwner, TOKEN_ID, newPrice);
    await expect(
      pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW)
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("reverts when trying to pay through a deactivated PaymentFacilitator", async function () {
    await pm.connect(admin).setFacilitator(pf.address, false);
    await expect(
      pf.connect(payer).pay(TOKEN_ID, AccessTypes.HOURLY_VIEW)
    ).to.be.revertedWith(
      "PaymentManager must be called by an active PaymentFacilitator contract"
    );
    // re-activate PF
    await pm.connect(admin).setFacilitator(pf.address, true);
  });
});
