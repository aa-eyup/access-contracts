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

describe("Owners ERC721", function () {
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
  let contentContract1155: Contract;

  describe("ERC721 content contract", function () {
    before(async function () {
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
      await stableCoin
        .connect(payer)
        .approve(pm.address, INITIAL_PAYER_BALANCE);
    });

    it("log deployed addresses", async function () {
      console.log("PaymentManager address: ", pm.address);
      console.log("PaymentFacilitator address: ", pf.address);
      console.log("Config address: ", config.address);
      console.log("Access NFT address: ", accessNFT.address);
    });

    it("should set the owner of a token", async function () {
      await ownersNFT
        .connect(collectionOwner)
        .setOwner(TOKEN_ID, paymentsOwner.address);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(paymentsOwner.address);
    });

    it("should set owner of a token if msg.sender is the content owner or is approved for all on the content contract", async function () {
      // need to mint a new token because the default already has an owner
      const tokenId = 1001;
      await contentContract721.mint(collectionOwner.address, tokenId);

      // approving the admin address for example which is not approved previously
      const isAdminApprovedBefore = await contentContract721.isApprovedForAll(
        collectionOwner.address,
        admin.address
      );
      expect(isAdminApprovedBefore).to.equal(false);
      await contentContract721
        .connect(collectionOwner)
        .setApprovalForAll(admin.address, true);
      // use a 3rd account to test owner setting
      await ownersNFT.connect(admin).setOwner(tokenId, accessor.address);
      expect(await ownersNFT.ownerOf(tokenId)).to.equal(accessor.address);
      // remove approval to avoid impact on subsequent tests
      await contentContract721
        .connect(collectionOwner)
        .setApprovalForAll(admin.address, false);
    });

    it("fails to set owner if the msg.sender is not the content owner or approved on the content contract", async function () {
      // need to mint a new token because the default already has an owner
      const tokenId = 1002;
      await contentContract721.mint(collectionOwner.address, tokenId);

      // approving the admin address for example which is not approved previously
      const isAdminApprovedBefore = await contentContract721.isApprovedForAll(
        collectionOwner.address,
        admin.address
      );
      expect(isAdminApprovedBefore).to.equal(false);
      // use a 3rd account to test owner setting
      await expect(
        ownersNFT.connect(admin).setOwner(tokenId, accessor.address)
      ).to.be.revertedWith(
        "Set Owner error: must own the token or be approved for all on the ERC721 content contract"
      );
    });

    it("fails to set owner if the token does not have an owner on the corresponding content contract", async () => {
      // need to mint a new token because the default already has an owner
      const tokenId = 1003;
      const isAdminApprovedBefore = await contentContract721.isApprovedForAll(
        collectionOwner.address,
        admin.address
      );
      expect(isAdminApprovedBefore).to.equal(false);
      await contentContract721
        .connect(collectionOwner)
        .setApprovalForAll(admin.address, true);
      await expect(
        ownersNFT.connect(admin).setOwner(tokenId, accessor.address)
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("should transferFrom Owner token", async function () {
      await ownersNFT
        .connect(paymentsOwner)
        .transferFrom(paymentsOwner.address, collectionOwner.address, TOKEN_ID);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(
        collectionOwner.address
      );
      await ownersNFT
        .connect(collectionOwner)
        .transferFrom(collectionOwner.address, paymentsOwner.address, TOKEN_ID);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(paymentsOwner.address);
    });

    it("should fail to transferFrom Owner token if current owner has a redeemable balance", async function () {
      const tokenId = 1004;
      await contentContract721.mint(collectionOwner.address, tokenId);
      await ownersNFT
        .connect(collectionOwner)
        .setOwner(tokenId, paymentsOwner.address);
      await setPriceOfAccess(accessNFT, paymentsOwner, tokenId, ACCESS_COST);
      await pf
        .connect(payer)
        .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
      await expect(
        ownersNFT
          .connect(paymentsOwner)
          .transferFrom(paymentsOwner.address, collectionOwner.address, tokenId)
      ).to.be.revertedWith(
        "Transfer Owner token error: redeemable balance of current owner must be 0"
      );
    });
  });

  describe("ERC1155 content contract", function () {
    before(async function () {
      [admin, payer, collectionOwner, paymentsOwner, accessor] =
        await ethers.getSigners();

      stableCoin = await deployStableCoin(payer.address, INITIAL_PAYER_BALANCE);

      contentContract1155 = await deployContentContract(
        collectionOwner.address,
        TOKEN_ID,
        NftType.ERC1155
      );
      assert(contentContract1155, "failed to deploy content contract");

      pm = await deployPaymentManager(admin.address, stableCoin.address);
      const contracts = await deployContracts({
        adminSigner: admin,
        paymentManagerContract: pm,
        contentAddress: contentContract1155.address,
      });
      pf = contracts.paymentFacilitator;
      config = contracts.config;
      accessNFT = contracts.accessNFT;
      ownersNFT = contracts.ownersNFT;

      // approve the payer on the Payment Manager so that the PM can pull funds
      await stableCoin
        .connect(payer)
        .approve(pm.address, INITIAL_PAYER_BALANCE);
    });

    it("log deployed addresses", async function () {
      console.log("PaymentManager address: ", pm.address);
      console.log("PaymentFacilitator address: ", pf.address);
      console.log("Config address: ", config.address);
      console.log("Access NFT address: ", accessNFT.address);
    });

    it("should set the owner of a token", async function () {
      await ownersNFT
        .connect(collectionOwner)
        .setOwner(TOKEN_ID, paymentsOwner.address);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(paymentsOwner.address);
    });

    it("should transferFrom Owner token", async function () {
      await ownersNFT
        .connect(paymentsOwner)
        .transferFrom(paymentsOwner.address, collectionOwner.address, TOKEN_ID);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(
        collectionOwner.address
      );
      await ownersNFT
        .connect(collectionOwner)
        .transferFrom(collectionOwner.address, paymentsOwner.address, TOKEN_ID);
      expect(await ownersNFT.ownerOf(TOKEN_ID)).to.equal(paymentsOwner.address);
    });

    it("should fail to transferFrom Owner token if current owner has a redeemable balance", async function () {
      const tokenId = 1004;
      await contentContract1155.mint(collectionOwner.address, tokenId);
      await ownersNFT
        .connect(collectionOwner)
        .setOwner(tokenId, paymentsOwner.address);
      await setPriceOfAccess(accessNFT, paymentsOwner, tokenId, ACCESS_COST);
      await pf
        .connect(payer)
        .payFor(tokenId, AccessTypes.HOURLY_VIEW, accessor.address);
      await expect(
        ownersNFT
          .connect(paymentsOwner)
          .transferFrom(paymentsOwner.address, collectionOwner.address, tokenId)
      ).to.be.revertedWith(
        "Transfer Owner token error: redeemable balance of current owner must be 0"
      );
    });
  });
});
