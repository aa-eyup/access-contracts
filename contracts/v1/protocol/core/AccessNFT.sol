// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IConfig.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";


/**
 * @title Access ERC1155 Contract
 * @notice Accessors of Content Contracts become owners of an NFT.
 * Ownership of the "Access" NFT can be checked when access to the Content Contract is requested.
 * Each Access "Type" would require its own Access NFT contract.
 * Assumptions:
 * TokenIds on this NFT contract map to the tokenId on the Contract Contract.
 */
contract Access is ERC1155Supply {
    string ACCESS_TYPE;
    IConfig private config;

    // tokenId => price to access the token
    mapping(uint256 => uint256) prices;
    // address => tokenId => timestamp
    mapping(address => mapping(uint256 => uint256)) previousPaymentTimestamp;
    // tokenId => supply limit
    mapping(uint256 => uint256) supplyLimit;

    constructor(string memory _accessType, address _contentConfig, string memory uri_) ERC1155(uri_) {
        ACCESS_TYPE = _accessType;
        config = IConfig(_contentConfig);
    }

    function mint(address _to, uint256 _id) external onlyFacilitator {
        require(
            supplyLimit[_id] == 0 || totalSupply(_id) < supplyLimit[_id],
            "Access token mint error: supply is capped"
        );
        _mint(_to, _id, 1, "");
    }

    /**
     * Override or set the timestamp which indicates the last time the account paid to access a given tokenId
     * The timestamp set can be used to check if an accessor needs to make another payment.
     * @param _id tokenId
     * @param _accessor the account which benefits from the payment
     */
    function setPreviousPaymentTime(uint256 _id, address _accessor) external onlyFacilitator {
        previousPaymentTimestamp[_accessor][_id] = block.timestamp;
    }

    function setPrice(uint256 _id, uint256 _price) external onlyContentOwner(_id) {
        prices[_id] = _price;
    }

    function setSupplyLimit(uint256 _id, uint256 _limit) external onlyContentOwner(_id) {
        require(_limit > totalSupply(_id), "Access: limit-below-current-supply");
        supplyLimit[_id] = _limit;
    }

    function getPrice(uint256 _id) external view returns(uint256) {
        return prices[_id];
    }

    function getPreviousPaymentTime(uint256 _id, address _accessor) external view returns(uint256) {
        return previousPaymentTimestamp[_accessor][_id];
    }

    modifier onlyFacilitator() {
        require(msg.sender == config.getPaymentFacilitator());
        _;
    }

    modifier onlyContentOwner(uint256 _id) {
        IERC721 content = IERC721(config.getContentNFT());
        // check owner or is approved
        address owner = content.ownerOf(_id);
        bool isApproved = content.isApprovedForAll(owner, msg.sender);
        require(msg.sender == owner || isApproved, "Access: must-be-content-owner-or-approved");
        _;
    }
}
