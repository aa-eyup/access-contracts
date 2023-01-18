// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "../../interfaces/IConfig.sol";

/**
 * @title Owners ERC1155 contract
 * @notice Used as source of truth regarding which accounts "own" rights over
 * the funds paid to access a given token on the Content Contract.
 * The owner(s) of a given token id will have the rights to the entirety of funds
 * paid for all access types to the respective token id's content.
 * There can be multiple accounts which own the rights to payments to access a given token.
 * This contract keeps track of the proportions of funds redeemable by owners.
 * Assumptions:
 * A token id on the Content Contract corresponds to the same token id on the Access NFTs and Owners NFT.
 */
contract Owners is ERC1155Supply {
    IConfig private config;
    uint16 public immutable FULL_OWNERSHIP_PERCENTAGE = 10000;

    constructor(address _contentConfig) ERC1155Supply("") {
        config = IConfig(_contentConfig);
    }

     /**
     * Mints the list of {@param _owners} tokens. Once FULL_OWNERSHIP_PERCENTAGE
     * number of tokens are minted (enforced by summing values
     * in {@param _ownershipPercentages}), then no more mints will be allowed.
     * This is the only external/public function that calls _mint.
     * Only the owner of the content can set the owners.
     *
     *
     * @param _id tokenId
     * @param _owners a list of owner addresses which will be minted ownership tokens
     * @param _ownershipPercentages a list of basis points (1 === 0.01%)
     */
    function setOwners(
        uint256 _id,
        address[] calldata _owners,
        uint8[] calldata _ownershipPercentages
    ) external {
        require(!exists(_id), "Owner tokens for content have already been minted");
        _verifyMsgSenderIsContentOwner(_id);

        // iterate through owners and percentages and validate, set data
        require(_owners.length == _ownershipPercentages.length, "Set Owners error: accounts and percentages length mismatch");
        uint16 percentageTotal = 0;
        for (uint8 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), 'Invalid: owner can not be address(0)');
            percentageTotal += _ownershipPercentages[i];
            // mint the token which represents ownership percentage
            _mint(_owners[i], _id, _ownershipPercentages[i], "");

        }
        require(percentageTotal == FULL_OWNERSHIP_PERCENTAGE, "Set Owners error: ownership percentages must add up to 100% (10000)");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        uint256 amount,
        bytes memory data
    ) public override verifyOwnerBalance(from) {
        super.safeTransferFrom(from, to, tokenId, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public override view verifyOwnerBalance(from) {
        revert("Batch Transfer of ownership tokens is not permitted");
    }

    /**
     * Verifies that the msg.sender is currently an owner of the given {@param _id}
     * on the content contract.
     * Content Contract must be an ERC721. Requiring a content contracts to have
     * only 1 owner simplifies process of setting owners of _id.
     *
     * @param _id tokenId
     */
    function _verifyMsgSenderIsContentOwnerOrApproved(uint256 _id) private view {
        address contentContract = config.getContentNFT();

        require(IERC165(contentContract).supportsInterface(0x80ac58cd), "Content is not ERC721");

        address contentOwner = IERC721(contentContract).ownerOf(_id);
        bool isApproved = IERC721(contentContract).isApprovedForAll(contentOwner, msg.sender);
        require(msg.sender == contentOwner || isApproved, "Set Owner error: must own the token or be approved for all on the ERC721 content contract");
    }

    /** Owners must withdraw all receivables before transferring ownership tokens */
    modifier verifyOwnerBalance(address _owner) {
        address paymentFacilitator = config.getPaymentFacilitator();
        (bool checkBalanceSuccess, bytes memory balanceData) = paymentFacilitator.staticcall(abi.encodeWithSignature("getOwnerBalance(address)", _owner));
        require(checkBalanceSuccess, "Failed to check outstanding balance credited to the current owner");
        uint256 balance = abi.decode(balanceData, (uint256));
        require(balance == 0, "Transfer Owner token error: redeemable balance of current owner must be 0");
        _;
    }
}
