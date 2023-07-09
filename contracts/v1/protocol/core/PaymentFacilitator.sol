// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
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

    // tokenId => address => withdrawable amount
    mapping(uint256 => mapping(address => uint256)) private withdrawable;

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

    function getWithdrawableBalance(address _account, uint256 _id) public view returns(uint256) {
        return withdrawable[_id][_account];
    }

    function pay(uint256 _id, string memory _accessType) external returns(bool) {
        return _pay(_id, _accessType, msg.sender, msg.sender);
    }

    function payFor(uint256 _id, string memory _accessType, address _accessor) external returns(bool) {
        return _pay(_id, _accessType, _accessor, msg.sender);
    }

    /**
     * @dev Creates a transfer from the `_payer` to the PaymentManager where the funds are earmarked for calling PaymentFacilitator contract.
     *
     * The price to pay is looked up on the accessNFT.
     * If the balance of the `_accessor` for the given `_id` on the accessNFT is not greater than 0,
     * then a token with id `_id` will be minted to the `_accessor`.
     *
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

        // PaymentManager is responsible for pulling funds
        uint256 amountPaid = paymentManager.pay(_id, _payer, address(accessNFT));

        (address[] memory tokenOwners, uint256[] memory share) = getAmountsForOwners(_id, amountPaid);
        mapping(address => uint256) storage withdrawableForToken = withdrawable[_id];
        for (uint16 i = 0; i < tokenOwners.length; i++) {
            withdrawableForToken[tokenOwners[i]] += share[i];
        }

        uint256 balance = accessNFT.balanceOf(_accessor, _id);
        if (!(balance > 0)) {
            (bool mintSuccess, ) = address(accessNFT).call(abi.encodeWithSignature("mint(address,uint256)", _accessor, _id));

            require(mintSuccess, "PaymentFacilitator: access-mint-failed");
        }
        (bool setTimestampSuccess, ) = address(accessNFT).call(abi.encodeWithSignature("setPreviousPaymentTime(uint256,address)", _id, _accessor));

        require(setTimestampSuccess, "PaymentFacilitator: failed-to-set-previous-payment-time");

        emit AccessPayment(address(accessNFT), _accessor, _payer, _id);
        return true;
    }

    /**
     * @dev Creates a transfer from the PaymentManager contract to the msg.sender if the msg.sender has any redeemable funds.
     * 1 owner maps to multiple accessNFTs so the owner has the rights to all funds paid for multiple access types.
     *
     * Emits a {Withdraw} event.
     *
     * Requirements:
     *
     * - the caller of the function (msg.sender) must be owner of `_id` on the Owners contract
     * - amount of funds withdrawable must be greater than 0
     */
    function withdraw(uint256 _id) external returns(uint256) {
        address receiver = msg.sender;
        uint256 amountToWithdraw = getWithdrawableBalance(receiver, _id);

        require(amountToWithdraw > 0, "PaymentFacilitator: zero-withdrawable-amount");

        withdrawable[_id][receiver] -= amountToWithdraw;

        require(withdrawable[_id][receiver] == 0, "PaymentFacilitator: incomplete-withdrawal");

        paymentManager.withdraw(receiver, amountToWithdraw);
        emit Withdraw(receiver, amountToWithdraw);

        return (amountToWithdraw);
    }

    function getAmountsForOwners(uint256 _id, uint256 _amount) private view returns (address[] memory, uint256[] memory) {
        address owners = config.getOwnersContract();

        (bool getTokenOwnersSuccess, bytes memory tokenOwnersBytes) = owners.staticcall(abi.encodeWithSignature("getOwners(uint256)", _id));

        require(getTokenOwnersSuccess, "PaymentFacilitator: failed-to-get-token-owners");

        address[] memory tokenOwners = abi.decode(tokenOwnersBytes, (address[]));

        (bool getPaymentSharesSuccess, bytes memory paymentShareBytes) = owners.staticcall(abi.encodeWithSignature("getOwnerSharesOfPayment(address[],uint256,uint256)", tokenOwners, _id, _amount));

        require(getPaymentSharesSuccess, "PaymentFacilitator: failed-to-get-payment-shares");

        uint256[] memory paymentShares = abi.decode(paymentShareBytes, (uint256[]));

        return (tokenOwners, paymentShares);
    }
}
