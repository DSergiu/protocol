import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenNonFiatCollateral, CTokenMock, ERC20Mock } from '../../../typechain'

task('deploy-ctoken-nonfiat-collateral', 'Deploys a CToken Non-Fiat Collateral')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('cToken', 'CToken address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('maxOracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLibrary', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // Get CToken to retrieve underlying
    const cToken: CTokenMock = <CTokenMock>(
      await hre.ethers.getContractAt('CTokenMock', params.cToken)
    )

    // Get Underlying
    const erc20: ERC20Mock = <ERC20Mock>(
      await hre.ethers.getContractAt('ERC20Mock', await cToken.underlying())
    )

    const CTokenNonFiatCollateralFactory = await hre.ethers.getContractFactory('CTokenNonFiatCollateral', {
      libraries: { OracleLib: params.oracleLibrary },
    })

    const collateral = <CTokenNonFiatCollateral>await CTokenNonFiatCollateralFactory.connect(deployer).deploy(
      params.referenceUnitFeed,
      params.targetUnitFeed,
      params.cToken,
      params.rewardToken,
      params.maxTradeVolume,
      params.maxOracleTimeout,
      params.targetName,
      params.defaultThreshold,
      params.delayUntilDefault,
      await erc20.decimals(), // Reference ERC20 decimals
      params.comptroller
    )
    await collateral.deployed()

    console.log(
      `Deployed CToken Non-Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
    )

    return { collateral: collateral.address }
  })
