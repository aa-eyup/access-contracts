// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../interfaces/IPaymentManager.sol";
import "./BaseRoleCheckerPausable.sol";

/**
 * @title PaymentManager contract
 * @notice Serves as the single source of funds used to pay for accessing Content Contracts.
 * Payments made to access any given content will be routed to this contract.
 * When content owners want to withdraw funds, the funds will come from this contract.
 * PaymentFacilitator contracts have accounts on this contract to keep track of how many
 * funds were deposited/withdrawn to/from this contract.
 */
contract PaymentManager is IPaymentManager, BaseRoleCheckerPausable {

    IERC20 stableCoin;
    mapping(address => FacilitatorAccount) facilitatorAccounts;

    struct FacilitatorAccount {
        uint256 balance;
        bool active;
    }

    constructor(address _admin, address _stableCoinAddress) {
        __BaseRoleCheckerPausable__init(_admin);
        stableCoin = IERC20(_stableCoinAddress);
    }

    function pay(uint256 _tokenId, address _payer, address _accessNFT) external activeFacilitator returns(uint256) {
        // call on AccessNFT to check amount to pull
        (bool getPriceSuccess, bytes memory getPriceData) = _accessNFT.staticcall(abi.encodeWithSignature("getPrice(uint256)", _tokenId));
        require(getPriceSuccess);
        uint256 price = abi.decode(getPriceData, (uint256));

        // call on token to transferFrom funds (revert if call fails)
        facilitatorAccounts[msg.sender].balance += price;
        bool transferSuccess = _doStableCoinTransfer(_payer, address(this), price);
        require(transferSuccess, "failed to transfer stable coin from payer");

        return price;
    }

    function withdraw(address _recipient, uint256 _amount) external activeFacilitator {
        require(_amount <= facilitatorAccounts[msg.sender].balance);
        facilitatorAccounts[msg.sender].balance -= _amount;
        bool transferSuccess = _doStableCoinTransfer(address(this), _recipient, _amount);
        require(transferSuccess, "failed to transfer stable coin from PaymentManager");
    }

    function setFacilitator(address _facilitator, bool _active) external onlyAdmin {
        FacilitatorAccount storage account = facilitatorAccounts[_facilitator];
        if (!_active) {
            require(account.balance == 0, "PaymentManager: non-zero-facilitator-balance");
        }
        account.active = _active;
    }

    function setStableCoin(address _stableCoinAddress) external onlyAdmin {
        stableCoin = IERC20(_stableCoinAddress);
    }

    function _doStableCoinTransfer(address _from, address _to, uint256 _amount) private returns(bool) {
        require(_to != address(0), "PaymentManager: zero-to-address");
        if (_from == address(this)) {
            return stableCoin.transfer(_to, _amount);
        }
        require(_from != address(0), "PaymentManager: zero-from-address");
        return stableCoin.transferFrom(_from, _to, _amount);
    }

    modifier activeFacilitator() {
        require(facilitatorAccounts[msg.sender].active, "PaymentManager must be called by an active PaymentFacilitator contract");
        _;
    }
}
