// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcadeXTxHub
 * @notice General transaction surface for ArcadeX on Arc Mainnet.
 * @dev Free `signIn(purpose)` for activity txs (e.g. play) plus USDC
 *      `payWithUSDC(purpose)` for paid flows. Fees are owner-configurable
 *      per purpose so new product uses do not require redeploy.
 */
contract ArcadeXTxHub {
    /// @notice Arc mainnet ERC-20 USDC (6 decimals).
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    address public owner;
    address public pendingOwner;
    bool public paused;

    /// @notice Per-purpose fee in USDC smallest units (6 decimals).
    mapping(bytes32 => uint256) public feeOf;
    /// @notice True after owner calls setFee for that purpose (paid paths require this).
    mapping(bytes32 => bool) public feeConfigured;

    uint256 public totalCollectedUSDC;
    uint256 public totalWithdrawnUSDC;

    mapping(address => uint256) public payCountUSDC;
    mapping(address => uint256) public signInCount;

    event SignedIn(address indexed player, bytes32 indexed purpose, uint256 timestamp);
    event EntryPaid(
        address indexed player,
        address indexed token,
        bytes32 indexed purpose,
        uint256 amount,
        uint256 timestamp
    );
    event FeeUpdated(bytes32 indexed purpose, uint256 oldFee, uint256 newFee);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error PausedError();
    error AlreadyPaused();
    error NotPaused();
    error ZeroAddress();
    error InvalidOwner();
    error PurposeNotConfigured();
    error NoBalance();
    error Reentrancy();
    error TransferFailed();
    error TransferAmountMismatch();
    error NoNativeValue();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrancy();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    /// @notice Gas-only activity / sign-in style tx. No value transfer.
    function signIn(bytes32 purpose) external whenNotPaused {
        unchecked {
            signInCount[msg.sender] += 1;
        }
        emit SignedIn(msg.sender, purpose, block.timestamp);
    }

    function payWithUSDC(bytes32 purpose) external nonReentrant whenNotPaused {
        if (!feeConfigured[purpose]) revert PurposeNotConfigured();
        uint256 amount = feeOf[purpose];

        unchecked {
            payCountUSDC[msg.sender] += 1;
            totalCollectedUSDC += amount;
        }

        _collectPayment(USDC, msg.sender, amount);
        emit EntryPaid(msg.sender, USDC, purpose, amount, block.timestamp);
    }

    /// @notice Configure (or update) the paid fee for a purpose. Enables payWithUSDC for that purpose.
    function setFee(bytes32 purpose, uint256 newFee) external onlyOwner {
        uint256 oldFee = feeOf[purpose];
        feeOf[purpose] = newFee;
        feeConfigured[purpose] = true;
        emit FeeUpdated(purpose, oldFee, newFee);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDC, address(this));
        if (bal == 0) revert NoBalance();
        totalWithdrawnUSDC += bal;
        _safeTransfer(USDC, owner, bal);
        emit WithdrawnUSDC(owner, bal);
    }

    function pause() external onlyOwner {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == USDC || newOwner == address(this)) {
            revert InvalidOwner();
        }
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
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

    function _collectPayment(address token, address player, uint256 amount) internal {
        uint256 contractBalanceBefore = _balanceOf(token, address(this));
        if (amount > 0) {
            _safeTransferFrom(token, player, address(this), amount);
        }
        uint256 contractBalanceAfter = _balanceOf(token, address(this));
        if (contractBalanceAfter < contractBalanceBefore + amount) {
            revert TransferAmountMismatch();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        if (!(success && (data.length == 0 || abi.decode(data, (bool))))) {
            revert TransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        if (!(success && (data.length == 0 || abi.decode(data, (bool))))) {
            revert TransferFailed();
        }
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", account)
        );
        require(success && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    receive() external payable {
        revert NoNativeValue();
    }

    fallback() external payable {
        revert NoNativeValue();
    }
}
