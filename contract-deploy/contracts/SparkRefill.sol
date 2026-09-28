// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SparkRefill
 * @notice Pay a configurable fee in USDC to refill sparks on Arc Mainnet.
 * @dev USDC-only (6-decimal ERC-20 at the Arc native USDC address).
 *      The fee is owner-adjustable post-deployment (e.g. for promotional discounts).
 */
contract SparkRefill {
    /// @notice Arc mainnet ERC-20 USDC (6 decimals). Same balance as native USDC / 10^12.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice Current fee, in USDC smallest units (6 decimals).
    /// @dev Mutable so the owner can run promotions without redeploying the contract.
    ///      Default: 50_000 = $0.05
    uint256 public fee = 50000;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    address public owner;
    address public pendingOwner;
    bool public paused;

    uint256 public totalCollectedUSDC;
    uint256 public totalWithdrawnUSDC;

    mapping(address => uint256) public payCountUSDC;

    event EntryPaid(address indexed player, address indexed token, uint256 amount, uint256 timestamp);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    function payWithUSDC() external nonReentrant whenNotPaused {
        uint256 amount = fee;

        payCountUSDC[msg.sender] += 1;
        totalCollectedUSDC += amount;

        _collectPayment(USDC, msg.sender, amount);

        emit EntryPaid(msg.sender, USDC, amount, block.timestamp);
    }

    function setFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = fee;
        fee = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDC, address(this));
        require(bal > 0, "No USDC to withdraw");
        totalWithdrawnUSDC += bal;
        _safeTransfer(USDC, owner, bal);
        emit WithdrawnUSDC(owner, bal);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        require(newOwner != USDC, "New owner cannot be USDC contract");
        require(newOwner != address(this), "New owner cannot be this contract");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function getBalanceUSDC() external view returns (uint256) {
        return _balanceOf(USDC, address(this));
    }

    function getStats()
        external
        view
        returns (
            uint256 currentUSDC,
            uint256 lifetimeUSDC,
            uint256 withdrawnUSDC
        )
    {
        currentUSDC = _balanceOf(USDC, address(this));
        lifetimeUSDC = totalCollectedUSDC;
        withdrawnUSDC = totalWithdrawnUSDC;
    }

    function getPayCount(address player) external view returns (uint256) {
        return payCountUSDC[player];
    }

    function getPayCountUSDC(address player) external view returns (uint256) {
        return payCountUSDC[player];
    }

    function _collectPayment(address token, address player, uint256 amount) internal {
        uint256 contractBalanceBefore = _balanceOf(token, address(this));
        if (amount > 0) {
            _safeTransferFrom(token, player, address(this), amount);
        }
        uint256 contractBalanceAfter = _balanceOf(token, address(this));
        require(
            contractBalanceAfter >= contractBalanceBefore + amount,
            "Transfer amount mismatch"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "transferFrom failed"
        );
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", account)
        );
        require(success && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    receive() external payable {
        revert("No native value accepted");
    }

    fallback() external payable {
        revert("No native value accepted");
    }
}
