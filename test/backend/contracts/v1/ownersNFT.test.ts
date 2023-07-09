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

    it("should mint to owners of a token", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);
    });

    it("fails to mint if ownership percentage is > 100%", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4001];
      await expect(
        ownersNFT
          .connect(collectionOwner)
          .setOwners(TOKEN_ID, owners, percentages)
      ).to.revertedWith("Owners: invalid-ownership-sum");
    });

    it("fails to mint if ownership percentage is < 100%", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 3000];
      await expect(
        ownersNFT
          .connect(collectionOwner)
          .setOwners(TOKEN_ID, owners, percentages)
      ).to.revertedWith("Owners: invalid-ownership-sum");
    });

    it("fails to mint if owner and percentage lengths mismatch", async function () {
      const owners = [collectionOwner.address];
      const percentages = [6000, 4001];
      await expect(
        ownersNFT
          .connect(collectionOwner)
          .setOwners(TOKEN_ID, owners, percentages)
      ).to.revertedWith("Owners: owner-percentage-length-mismatch");
    });

    it("should set owner if called by address approved on contract", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];

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
      await ownersNFT.connect(admin).setOwners(tokenId, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, tokenId)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, tokenId)
      ).to.equal(4000);
    });

    it("fails to set owner if the msg.sender is not the content owner or approved", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await expect(
        ownersNFT.connect(admin).setOwners(TOKEN_ID, owners, percentages)
      ).to.be.revertedWith("Owners: invalid-set-owner-permission");
    });

    it("fails to set owner if the content does not have owner", async () => {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      // use a tokenId does not have an owner on the ERC721 content contract
      const tokenId = 1003;
      await expect(
        ownersNFT.connect(admin).setOwners(tokenId, owners, percentages)
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("should succeed to transfer Owner ERC1155 token", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);

      await ownersNFT
        .connect(collectionOwner)
        .safeTransferFrom(
          collectionOwner.address,
          paymentsOwner.address,
          TOKEN_ID,
          1000,
          "0x00"
        );
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(5000);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(5000);
    });

    it("should update owners when from is no longer owner", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);

      await ownersNFT
        .connect(collectionOwner)
        .safeTransferFrom(
          collectionOwner.address,
          paymentsOwner.address,
          TOKEN_ID,
          6000,
          "0x00"
        );
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(10000);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(0);

      const ownersFromContract = await ownersNFT.getOwners(TOKEN_ID);
      // NOTICE: this is an expensive check
      expect(
        ownersFromContract.indexOf(collectionOwner.address.toUpperCase())
      ).to.equal(-1);
    });

    it("should update owners when to is a new owner", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);

      await ownersNFT
        .connect(collectionOwner)
        .safeTransferFrom(
          collectionOwner.address,
          admin.address,
          TOKEN_ID,
          1000,
          "0x00"
        );
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);
      expect(await ownersNFT.balanceOf(admin.address, TOKEN_ID)).to.equal(1000);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(5000);

      const ownersFromContract = await ownersNFT.getOwners(TOKEN_ID);

      let senderFound = false;
      let receiverFound = false;
      for (let i = 0; i < ownersFromContract.length; i++) {
        if (ownersFromContract[i] == collectionOwner.address) {
          senderFound = true;
        }

        if (ownersFromContract[i] == admin.address) {
          receiverFound = true;
        }
        if (senderFound && receiverFound) {
          break;
        }
      }
      expect(senderFound && receiverFound).to.equal(true);
    });

    it("should return owner share for a given token and amount", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);

      await ownersNFT
        .connect(collectionOwner)
        .safeTransferFrom(
          collectionOwner.address,
          admin.address,
          TOKEN_ID,
          1000,
          "0x00"
        );
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);
      expect(await ownersNFT.balanceOf(admin.address, TOKEN_ID)).to.equal(1000);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(5000);

      const ownersFromContract = await ownersNFT.getOwners(TOKEN_ID);

      const payment = 12020;

      const amounts = await ownersNFT.getOwnerSharesOfPayment(
        ownersFromContract,
        TOKEN_ID,
        payment
      );

      const balances = [];
      for (let i = 0; i < ownersFromContract.length; i++) {
        const balance = await ownersNFT.balanceOf(
          ownersFromContract[i],
          TOKEN_ID
        );
        // full owners would be 10000 tokens
        balances.push((balance * payment) / 10000);
      }

      expect(amounts.map((b) => b.toNumber())).to.deep.equal(balances);
    });

    it("fails to transfer Owner token if current sender has a redeemable balance", async function () {
      const owners = [collectionOwner.address, paymentsOwner.address];
      const percentages = [6000, 4000];
      await ownersNFT
        .connect(collectionOwner)
        .setOwners(TOKEN_ID, owners, percentages);
      expect(
        await ownersNFT.balanceOf(collectionOwner.address, TOKEN_ID)
      ).to.equal(6000);
      expect(
        await ownersNFT.balanceOf(paymentsOwner.address, TOKEN_ID)
      ).to.equal(4000);

      // pay for access
      await setPriceOfAccess(accessNFT, collectionOwner, TOKEN_ID, ACCESS_COST);
      await pf
        .connect(payer)
        .payFor(TOKEN_ID, AccessTypes.HOURLY_VIEW, accessor.address);

      const withdrawableBalance = await pf.getWithdrawableBalance(
        collectionOwner.address,
        TOKEN_ID
      );

      await expect(
        ownersNFT
          .connect(collectionOwner)
          .safeTransferFrom(
            collectionOwner.address,
            paymentsOwner.address,
            TOKEN_ID,
            1000,
            "0x00"
          )
      ).to.revertedWith("Owners: withdrawable-balance-must-be-zero");
    });
  });
});
