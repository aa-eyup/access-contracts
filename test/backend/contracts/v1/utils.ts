import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts/lib/index";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccessTypes, NftType } from "./types";

export const deployPaymentManager = async (
  adminAddress: string,
  stableCoinAddress: string
): Promise<Contract> => {
  return await deployGenericContract("PaymentManager", [
    adminAddress,
    stableCoinAddress,
  ]);
};

export const deployStableCoin = async (
  payerAddress: string,
  mintAmount: number
): Promise<Contract> => {
  return await deployGenericContract("StableCoin", [payerAddress, mintAmount]);
};

export const deployContentContract = async (
  owner: string,
  tokenId: number,
  nftType: NftType
): Promise<Contract> => {
  if (nftType === NftType.ERC721) {
    return await deployGenericContract("ContentContract721", [owner, tokenId]);
  } else if (nftType === NftType.ERC1155) {
    return await deployGenericContract("ContentContract1155", [owner, tokenId]);
  } else {
    throw new Error("unsupport nft type");
  }
};

export const deployContracts = async ({
  adminSigner,
  paymentManagerContract,
  contentAddress,
}: Record<string, any>): Promise<Record<string, Contract>> => {
  // deploy config contract
  const config = await deployGenericContract("ContentConfig", [
    adminSigner.address,
  ]);

  // deploy Owners
  const owners = await deployGenericContract("Owners", [config.address]);

  // deploy Access NFT(s)
  const accessHourly = await deployGenericContract("Access", [
    AccessTypes.HOURLY_VIEW,
    config.address,
    "",
  ]);

  // deploy PaymentFacilitator
  const paymentFacilitator = await deployGenericContract("PaymentFacilitator", [
    config.address,
    paymentManagerContract.address,
  ]);

  // init config contract
  await config
    .connect(adminSigner)
    .__ContentConfig__init(
      [AccessTypes.HOURLY_VIEW],
      [accessHourly.address],
      paymentFacilitator.address,
      owners.address,
      contentAddress
    );

  // set payment facilitator on PM
  await paymentManagerContract
    .connect(adminSigner)
    .setFacilitator(paymentFacilitator.address, true);

  return {
    paymentFacilitator,
    config,
    accessNFT: accessHourly,
    ownersNFT: owners,
  };
};

export const setPriceOfAccess = async (
  accessNFT: Contract,
  caller: SignerWithAddress,
  tokenId: number,
  price: number
): Promise<void> => {
  await accessNFT.connect(caller).setPrice(tokenId, price);
};

const deployGenericContract = async (
  contractName: string,
  args: any[]
): Promise<Contract> => {
  const Contract = await ethers.getContractFactory(contractName);
  const contract = await Contract.deploy(...args);
  await contract.deployed();
  return contract;
};
