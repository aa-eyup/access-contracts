// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "../../interfaces/IConfig.sol";

/**
 * @title Owners ERC1155 contract
 * @notice Used as source of truth regarding which accounts "own" rights over the funds paid to access a given token on the Content Contract.
 * The owner(s) of a given token id will have the rights to the funds paid for all access types to the respective token id's content.
 * There can be multiple accounts which own the rights to payments to access a given token.
 * This contract keeps track of the proportions of funds redeemable by owners.
 *
 * Assumptions:
 * A token id on the Content Contract corresponds to the same token id on the Access NFTs and Owners NFT.
 */
contract Owners is ERC1155Supply {
    IConfig private config;
    // 1 token of this ERC1155 = 1 basis point of ownership
    uint16 public immutable FULL_OWNERSHIP_PERCENTAGE = 10000;
    // use dynamic array to avoid over allocating space
    mapping(uint256 => address[]) public owners;

    constructor(address _contentConfig) ERC1155("") {
        config = IConfig(_contentConfig);
    }

     /**
     * Mints the list of {@param _owners} tokens. Once FULL_OWNERSHIP_PERCENTAGE
     * number of tokens are minted (enforced by summing values
     * in {@param _ownershipPercentages}), then no more mints will be allowed.
     * This is the only external/public function that calls _mint.
     *
     * @param _id tokenId
     * @param _owners a list of owner addresses which will be minted ownership tokens
     * @param _ownershipPercentages a list of basis points (1 === 0.01%)
     */
    function setOwners(
        uint256 _id,
        address[] calldata _owners,
        uint16[] calldata _ownershipPercentages
    ) external {
        require(!exists(_id), "Owners: previously-minted");
        _verifySetOwnerPermission(_id);

        // iterate through owners and percentages and validate, set data
        require(_owners.length == _ownershipPercentages.length, "Owners: owner-percentage-length-mismatch");

        uint16 percentageTotal = 0;
        for (uint8 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), 'Owners: zero-address-owner');
            percentageTotal += _ownershipPercentages[i];
            // mint the token which represents ownership percentage
            _mint(_owners[i], _id, _ownershipPercentages[i], "");
            // set owner into state
            owners[_id].push(_owners[i]);
        }
        require(percentageTotal == FULL_OWNERSHIP_PERCENTAGE, "Owners: invalid-ownership-sum");
    }

     /**
     * Returns an array of addresses which hold ERC1155 tokens for the given `_id`.
     * The array is managed on mint and transfers (tokens can not be burned).
     *
     * @param _id tokenId
     */
    function getOwners(uint256 _id) public view returns (address[] memory) {
        return owners[_id];
    }

     /**
     * Returns an array of amounts representing the fair share of the `_amount`.
     * Index in `_owners` maps to the index in the output.
     *
     * @param _owners a list of accounts
     * @param _id tokenId
     * @param _amount amount of payment to be split between owners
     */
    function getOwnerSharesOfPayment(address[] memory _owners, uint256 _id, uint256 _amount) public view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](_owners.length);
        for (uint16 i = 0; i < _owners.length; i++) {
            amounts[i] = balanceOf(_owners[i], _id) * _amount / uint256(FULL_OWNERSHIP_PERCENTAGE);
        }
        return amounts;
    }

    /** sender's withdrawable balance must be 0 to transfer ownership tokens */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        uint256 amount,
        bytes memory data
    ) public override verifyOwnerBalance(from, tokenId) {
        super.safeTransferFrom(from, to, tokenId, amount, data);
        reassignOwners(from, to, tokenId);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public override pure {
        revert("Owners: Batch Transfer of ownership tokens is not permitted");
    }

    function reassignOwners(address from, address to, uint256 _id) private {
        int16 iTo = -1;
        int16 iFrom = -1;
        int16 firstZeroSlot = -1;

        address[] storage tokenOwners = owners[_id];

        for (uint16 i = 0; i < tokenOwners.length; i++) {
            if (firstZeroSlot < 0 && tokenOwners[i] == address(0)) {
                firstZeroSlot = int16(i);
            }
            if (tokenOwners[i] == to) {
                iTo = int16(i);
            }
            if (tokenOwners[i] == from) {
                iFrom = int16(i);
            }
            if (iTo >= 0 && iFrom >= 0) {
                break;
            }
        }

        require(iFrom >= 0, "Owners: from-account-not-owner");

        if (balanceOf(from, _id) == 0) {
            tokenOwners[uint16(iFrom)] = tokenOwners[tokenOwners.length - 1];
            tokenOwners.pop();
        }
        if (iTo < 0) {
            tokenOwners.push(to);
        }
    }

    /**
     * Verifies that the msg.sender is currently an owner or has approval of the given {@param _id}
     * on the content contract or approved.
     * Content Contract must be an ERC721.
     *
     * @param _id tokenId
     */
    function _verifySetOwnerPermission(uint256 _id) private view {
        address contentContract = config.getContentNFT();

        require(IERC165(contentContract).supportsInterface(0x80ac58cd), "Content is not ERC721");

        address contentOwner = IERC721(contentContract).ownerOf(_id);
        bool isApproved = IERC721(contentContract).isApprovedForAll(contentOwner, msg.sender);

        require(msg.sender == contentOwner || isApproved, "Owners: invalid-set-owner-permission");
    }

    /** Owners must withdraw all receivables before transferring ownership tokens */
    modifier verifyOwnerBalance(address _owner, uint256 _id) {
        address paymentFacilitator = config.getPaymentFacilitator();
        (bool checkBalanceSuccess, bytes memory balanceData) = paymentFacilitator.staticcall(abi.encodeWithSignature("getWithdrawableBalance(address,uint256)", _owner, _id));

        require(checkBalanceSuccess, "Owners: withdrawable-balance-check-failed");

        uint256 balance = abi.decode(balanceData, (uint256));

        require(balance == 0, "Owners: withdrawable-balance-must-be-zero");
        _;
    }
}
