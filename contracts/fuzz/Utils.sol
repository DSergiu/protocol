// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/p0/Deployer.sol";

function defaultParams() pure returns (DeploymentParams memory params) {
    params = DeploymentParams({
        maxTradeVolume: 1e24,
        dist: RevenueShare({ rTokenDist: 2, rsrDist: 3 }),
        rewardPeriod: 604800, // 1 week
        rewardRatio: FixLib.divu(toFix(22840), (1_000_000)), // approx. half life of 30 pay periods
        unstakingDelay: 1209600, // 2 weeks
        tradingDelay: 0, // (the delay _after_ default has been confirmed)
        auctionLength: 1800, // 30 minutes
        backingBuffer: FixLib.divu(toFix(1), 10000), // 0.01%, 1 BIP
        maxTradeSlippage: FixLib.divu(toFix(1), 100), // 1%
        dustAmount: FixLib.divu(toFix(1), 100), // 0.01 UoA (USD)
        issuanceRate: FixLib.divu(toFix(25), 1_000_000), // 0.025% per block or ~0.1% per minute
        oneshotFreezeDuration: 864000, // 10 days
        minBidSize: toFix(1) // 1 UoA (USD)
    });
}
