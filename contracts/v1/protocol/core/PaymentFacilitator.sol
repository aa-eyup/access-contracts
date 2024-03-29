// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../../interfaces/IPaymentManager.sol";
import "../../interfaces/IConfig.sol";

/**
 * @title PaymentFacilitator contract
 * @notice Serves as access point to deposit/withdraw funds.
 * When a content accessor deposits funds to access content, 
 * it will be sent to this contract which will then forward it to the PaymentManager contract.
 * When a content creator wants to withdraw funds, this contract will pull funds from PaymentManager
 * and then send them to the withdrawer.
 * This contract keeps track of how many funds were deposited to access a given token ID on the Content Contract.
 * Checks the AccessNFT to see if payer already has access, if not, mints token on AccessNFT for payer.
 */
contract PaymentFacilitator {
    IConfig private config;
    IPaymentManager private paymentManager;

    // keep track of how much Owners are able to withdraw
    mapping(address => uint256) ownerBalances;

    /**
     * @dev Emitted when tokens are transferred from `payer` to the PaymentManager contract to gain access to token `id` on the `accessNFT` contract
     */
    event AccessPayment(address indexed accessNFT, address indexed accessor, address indexed payer, uint256 id);
    /**
     * @dev Emitted when an owner withdraws funds which were paid to access 1 or more tokens accross all `accessNFT` contracts
     */
    event Withdraw(address indexed owner, uint256 amount);

    constructor (address _contentConfig, address _paymentManager) {
        config = IConfig(_contentConfig);
        paymentManager = IPaymentManager(_paymentManager);
    }

    function pay(uint256 _id, string memory _accessType) external returns(bool) {
        return _pay(_id, _accessType, msg.sender, msg.sender);
    }

    function payFor(uint256 _id, string memory _accessType, address _accessor) external returns(bool) {
        return _pay(_id, _accessType, _accessor, msg.sender);
    }

    /**
     * @dev Creates a transfer from the `_payer` to the PaymentManager where the funds are earmarked for the owner of `_id`.
     * The price to pay is looked up from the accessNFT.
     * If the balance of the `_accessor` for the given `_id` on the accessNFT is not greater than 0,
     * then a token with id `_id` will be minted to the `_accessor`.
     * A timestamp will be set to reflect the time of payment for the `_accessor` and then given `_id` on the respective accessNFT.
     *
     * Emits a {AccessPayment} event.
     *
     * Requirements:
     *
     * - the PaymenetManager contract must be approved by the `_payer` on the stablecoin's ERC20 contract
     * - `_accessType` must be a valid access type which was set on the Config contract during initialization.
     */
    function _pay(uint256 _id, string memory _accessType, address _accessor, address _payer) private returns(bool) {
        IERC1155 accessNFT = IERC1155(config.getAccessNFT(_accessType));
        IERC721 owners = IERC721(config.getOwnersContract());
        // PaymentManager is responsible for actually pulling funds
        uint256 amountPaid = paymentManager.pay(_id, _payer, address(accessNFT));

        // update the amount owner of the content token has been paid
        try owners.ownerOf(_id) returns (address owner) {
            ownerBalances[owner] += amountPaid;
        } catch {
            revert("Payment error: owner must be set");
        }

        uint256 balance = accessNFT.balanceOf(_accessor, _id);
        if (!(balance > 0)) {
            (bool mintSuccess, ) = address(accessNFT).call(abi.encodeWithSignature("mint(address,uint256)", _accessor, _id));
            require(mintSuccess, "Failed to mint Access token");
        }
        (bool setTimestampSuccess, ) = address(accessNFT).call(abi.encodeWithSignature("setPreviousPaymentTime(uint256,address)", _id, _accessor));
        require(setTimestampSuccess, "Failed to set previous payment timestamp");

        emit AccessPayment(address(accessNFT), _accessor, _payer, _id);
        return true;
    }

    /**
     * @dev Creates a transfer from the PaymentManager contract to the msg.sender if the msg.sender has any redeemable funds.
     * 1 owner maps to multiple accessNFTs so the owner has the rights to all funds paid for multiple access types.
     * The withdrawal flow is designed this way so that the Owner does not
     * have to create a withdrawal transaction for every single token they "own"
     * the rights to the payments for.
     *
     * Emits a {Withdraw} event.
     *
     * Requirements:
     *
     * - the caller of the function (msg.sender) must be owner of `_id` on the Owners contract
     * - amount of funds withdrawable must be greater than 0
     */
    function withdraw() external returns(uint256) {
        require(ownerBalances[msg.sender] > 0, "Withdrawal error: 0 funds available");
        
        uint256 amountToWithdraw = ownerBalances[msg.sender];
        ownerBalances[msg.sender] -= amountToWithdraw;
        paymentManager.withdraw(msg.sender, amountToWithdraw);
        emit Withdraw(msg.sender, amountToWithdraw);

        return (amountToWithdraw);
    }

    function getOwnerBalance(address _owner) external view returns(uint256) {
        return ownerBalances[_owner];
    }
}
