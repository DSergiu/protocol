import { Fixture } from 'ethereum-waffle'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, IImplementations, IRevenueShare, networkConfig } from '../../common/configuration'
import { expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import { ZERO_ADDRESS, MAX_ORACLE_TIMEOUT } from '../../common/constants'
import {
  AaveLendingPoolMock,
  Asset,
  AssetRegistryP1,
  ATokenFiatCollateral,
  ATokenMock,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  ComptrollerMock,
  CTokenFiatCollateral,
  ERC20Mock,
  DeployerP0,
  DeployerP1,
  Facade,
  DistributorP1,
  FurnaceP1,
  GnosisTrade,
  IAssetRegistry,
  IBasketHandler,
  IERC20Metadata,
  IGnosis,
  MainP1,
  OracleLib,
  RevenueTraderP1,
  RewardableLibP1,
  RTokenAsset,
  RTokenP1,
  StaticATokenLM,
  StRSRP1Votes,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  TradingLibP0,
  TradingLibP1,
} from '../../typechain'

import { Collateral, Implementation, IMPLEMENTATION } from '../fixtures'

interface RSRFixture {
  rsr: ERC20Mock
}

async function rsrFixture(): Promise<RSRFixture> {
  // Deploy RSR and asset
  const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')

  return { rsr }
}

interface COMPAAVEFixture {
  weth: ERC20Mock
  compToken: ERC20Mock
  compoundMock: ComptrollerMock
  aaveToken: ERC20Mock
  aaveMock: AaveLendingPoolMock
}

async function compAaveFixture(): Promise<COMPAAVEFixture> {
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get COMP token
  const compToken: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
  )

  // Get AAVE token
  const aaveToken: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.stkAAVE || '')
  )

  // Get WETH
  const weth: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
  )

  // Get Comp and Aave contracts
  const compoundMock: ComptrollerMock = <ComptrollerMock>(
    await ethers.getContractAt('ComptrollerMock', networkConfig[chainId].COMPTROLLER || '')
  )

  const aaveMock: AaveLendingPoolMock = <AaveLendingPoolMock>(
    await ethers.getContractAt(
      'AaveLendingPoolMock',
      networkConfig[chainId].AAVE_LENDING_POOL || ''
    )
  )

  return {
    weth,
    compToken,
    compoundMock,
    aaveToken,
    aaveMock,
  }
}

interface ModuleFixture {
  gnosis: IGnosis
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const EasyAuctionFactory: ContractFactory = await ethers.getContractFactory('EasyAuction')
  const gnosis: IGnosis = <IGnosis>await EasyAuctionFactory.deploy()
  return { gnosis: gnosis }
}

interface CollateralFixture {
  erc20s: IERC20Metadata[] // all erc20 addresses
  collateral: Collateral[] // all collateral
  basket: Collateral[] // only the collateral actively backing the RToken
  basketsNeededAmts: BigNumber[] // reference amounts
}

async function collateralFixture(
  oracleLib: OracleLib,
  comptroller: ComptrollerMock,
  aaveLendingPool: AaveLendingPoolMock,
  aaveToken: ERC20Mock,
  compToken: ERC20Mock,
  config: IConfig
): Promise<CollateralFixture> {
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')
  const CollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  // Deploy all potential collateral assets
  const makeVanillaCollateral = async (
    tokenAddr: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, Collateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>await ethers.getContractAt('ERC20Mock', tokenAddr)
    return [
      erc20,
      <Collateral>(
        await CollateralFactory.deploy(
          chainlinkAddr,
          erc20.address,
          ZERO_ADDRESS,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault
        )
      ),
    ]
  }

  const makeSixDecimalCollateral = async (
    tokenAddr: string,
    chainlinkAddr: string
  ): Promise<[IERC20Metadata, Collateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>await ethers.getContractAt('USDCMock', tokenAddr)
    return [
      erc20,
      <Collateral>(
        await CollateralFactory.deploy(
          chainlinkAddr,
          erc20.address,
          ZERO_ADDRESS,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault
        )
      ),
    ]
  }

  const makeCTokenCollateral = async (
    tokenAddress: string,
    referenceERC20: IERC20Metadata,
    chainlinkAddr: string,
    compToken: ERC20Mock
  ): Promise<[IERC20Metadata, CTokenFiatCollateral]> => {
    const erc20: IERC20Metadata = <IERC20Metadata>(
      await ethers.getContractAt('CTokenMock', tokenAddress)
    )
    return [
      erc20,
      <CTokenFiatCollateral>(
        await CTokenCollateralFactory.deploy(
          chainlinkAddr,
          erc20.address,
          compToken.address,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          (await referenceERC20.decimals()).toString(),
          comptroller.address
        )
      ),
    ]
  }

  const makeATokenCollateral = async (
    tokenAddress: string,
    chainlinkAddr: string,
    aaveToken: ERC20Mock
  ): Promise<[IERC20Metadata, ATokenFiatCollateral]> => {
    const erc20: ATokenMock = <ATokenMock>await ethers.getContractAt('ATokenMock', tokenAddress)
    const name: string = await erc20.name()
    const symbol: string = await erc20.symbol()

    // Wrap in Static AToken
    const staticErc20: StaticATokenLM = <StaticATokenLM>(
      await StaticATokenFactory.deploy(
        aaveLendingPool.address,
        erc20.address,
        'Static ' + name,
        'stat' + symbol
      )
    )

    return [
      staticErc20 as IERC20Metadata,
      <ATokenFiatCollateral>(
        await ATokenCollateralFactory.deploy(
          chainlinkAddr,
          staticErc20.address,
          aaveToken.address,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault
        )
      ),
    ]
  }

  // Create all possible collateral
  const DAI_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.DAI as string
  const USDC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDC as string
  const USDT_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDT as string
  const BUSD_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.BUSD as string

  const dai = await makeVanillaCollateral(
    networkConfig[chainId].tokens.DAI as string,
    DAI_USD_PRICE_FEED
  )
  const usdc = await makeSixDecimalCollateral(
    networkConfig[chainId].tokens.USDC as string,
    USDC_USD_PRICE_FEED
  )
  const usdt = await makeVanillaCollateral(
    networkConfig[chainId].tokens.USDT as string,
    USDT_USD_PRICE_FEED
  )
  const busd = await makeVanillaCollateral(
    networkConfig[chainId].tokens.BUSD as string,
    BUSD_USD_PRICE_FEED
  )
  const cdai = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cDAI as string,
    dai[0],
    DAI_USD_PRICE_FEED,
    compToken
  )
  const cusdc = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cUSDC as string,
    usdc[0],
    USDC_USD_PRICE_FEED,
    compToken
  )
  const cusdt = await makeCTokenCollateral(
    networkConfig[chainId].tokens.cUSDT as string,
    usdt[0],
    USDT_USD_PRICE_FEED,
    compToken
  )
  const adai = await makeATokenCollateral(
    networkConfig[chainId].tokens.aDAI as string,
    DAI_USD_PRICE_FEED,
    aaveToken
  )
  const ausdc = await makeATokenCollateral(
    networkConfig[chainId].tokens.aUSDC as string,
    USDC_USD_PRICE_FEED,
    aaveToken
  )
  const ausdt = await makeATokenCollateral(
    networkConfig[chainId].tokens.aUSDT as string,
    USDT_USD_PRICE_FEED,
    aaveToken
  )
  const abusd = await makeATokenCollateral(
    networkConfig[chainId].tokens.aBUSD as string,
    BUSD_USD_PRICE_FEED,
    aaveToken
  )
  const erc20s = [
    dai[0],
    usdc[0],
    usdt[0],
    busd[0],
    cdai[0],
    cusdc[0],
    cusdt[0],
    adai[0],
    ausdc[0],
    ausdt[0],
    abusd[0],
  ]
  const collateral = [
    dai[1],
    usdc[1],
    usdt[1],
    busd[1],
    cdai[1],
    cusdc[1],
    cusdt[1],
    adai[1],
    ausdc[1],
    ausdt[1],
    abusd[1],
  ]

  // Create the initial basket
  const basket = [dai[1], adai[1], cdai[1]]
  const basketsNeededAmts = [fp('0.25'), fp('0.25'), fp('0.5')]

  return {
    erc20s,
    collateral,
    basket,
    basketsNeededAmts,
  }
}

type RSRAndCompAaveAndCollateralAndModuleFixture = RSRFixture &
  COMPAAVEFixture &
  CollateralFixture &
  ModuleFixture

interface DefaultFixture extends RSRAndCompAaveAndCollateralAndModuleFixture {
  config: IConfig
  dist: IRevenueShare
  deployer: TestIDeployer
  main: TestIMain
  assetRegistry: IAssetRegistry
  backingManager: TestIBackingManager
  basketHandler: IBasketHandler
  distributor: TestIDistributor
  rsrAsset: Asset
  compAsset: Asset
  aaveAsset: Asset
  rToken: TestIRToken
  rTokenAsset: RTokenAsset
  furnace: TestIFurnace
  stRSR: TestIStRSR
  facade: Facade
  broker: TestIBroker
  rsrTrader: TestIRevenueTrader
  rTokenTrader: TestIRevenueTrader
  oracleLib: OracleLib
}

export const defaultFixture: Fixture<DefaultFixture> = async function ([
  owner,
]): Promise<DefaultFixture> {
  let facade: Facade
  const { rsr } = await rsrFixture()
  const { weth, compToken, compoundMock, aaveToken, aaveMock } = await compAaveFixture()
  const { gnosis } = await gnosisFixture()
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }

  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Setup Config
  const config: IConfig = {
    maxTradeVolume: fp('1e6'), // $1M
    dist: dist,
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    dustAmount: fp('0.01'), // 0.01 UoA (USD)
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    oneshotFreezeDuration: bn('864000'), // 10 days
    minBidSize: fp('0.001'), // 0.1% of the minBuyAmount
  }

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
  const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

  // Deploy OracleLib external library
  const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
  const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()

  // Deploy Facade
  const FacadeFactory: ContractFactory = await ethers.getContractFactory('Facade')
  facade = <Facade>await FacadeFactory.deploy()

  // Deploy RSR Asset
  const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
  const rsrAsset: Asset = <Asset>(
    await AssetFactory.deploy(
      networkConfig[chainId].chainlinkFeeds.RSR || '',
      rsr.address,
      ZERO_ADDRESS,
      config.maxTradeVolume,
      MAX_ORACLE_TIMEOUT
    )
  )

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(rsr.address, gnosis.address, facade.address, rsrAsset.address)
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    // Deploy TradingLib external library
    const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP1')
    const tradingLib: TradingLibP1 = <TradingLibP1>await TradingLibFactory.deploy()

    // Deploy RewardableLib external library
    const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
    const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      { libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address } }
    )
    const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

    const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
      'BasketHandlerP1'
    )
    const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

    const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
    const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

    const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory(
      'RevenueTraderP1',
      { libraries: { RewardableLibP1: rewardableLib.address, TradingLibP1: tradingLib.address } }
    )
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1', {
      libraries: { RewardableLibP1: rewardableLib.address },
    })
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes')
    const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

    // Setup Implementation addresses
    const implementations: IImplementations = {
      main: mainImpl.address,
      trade: tradeImpl.address,
      components: {
        assetRegistry: assetRegImpl.address,
        backingManager: backingMgrImpl.address,
        basketHandler: bskHndlrImpl.address,
        broker: brokerImpl.address,
        distributor: distribImpl.address,
        furnace: furnaceImpl.address,
        rsrTrader: revTraderImpl.address,
        rTokenTrader: revTraderImpl.address,
        rToken: rTokenImpl.address,
        stRSR: stRSRImpl.address,
      },
    }

    // Deploy FacadeP1
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeP1')
    facade = <Facade>await FacadeFactory.deploy()

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(
        rsr.address,
        gnosis.address,
        facade.address,
        rsrAsset.address,
        implementations
      )
    )
  }

  // Deploy actual contracts
  const receipt = await (
    await deployer.deploy('RTKN RToken', 'RTKN', 'manifesto', owner.address, config)
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
  const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

  // Get Core
  const assetRegistry: IAssetRegistry = <IAssetRegistry>(
    await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
  )
  const backingManager: TestIBackingManager = <TestIBackingManager>(
    await ethers.getContractAt('TestIBackingManager', await main.backingManager())
  )
  const basketHandler: IBasketHandler = <IBasketHandler>(
    await ethers.getContractAt('IBasketHandler', await main.basketHandler())
  )
  const distributor: TestIDistributor = <TestIDistributor>(
    await ethers.getContractAt('TestIDistributor', await main.distributor())
  )

  const aaveAsset: Asset = <Asset>(
    await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      networkConfig[chainId].chainlinkFeeds.AAVE || '',
      aaveToken.address,
      ZERO_ADDRESS,
      config.maxTradeVolume,
      MAX_ORACLE_TIMEOUT
    )
  )

  const compAsset: Asset = <Asset>await (
    await ethers.getContractFactory('Asset')
  ).deploy(
    networkConfig[chainId].chainlinkFeeds.COMP || '',
    compToken.address,
    ZERO_ADDRESS, // also uncertain about this one
    config.maxTradeVolume,
    MAX_ORACLE_TIMEOUT
  )
  const rToken: TestIRToken = <TestIRToken>(
    await ethers.getContractAt('TestIRToken', await main.rToken())
  )
  const rTokenAsset: RTokenAsset = <RTokenAsset>(
    await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
  )

  const broker: TestIBroker = <TestIBroker>(
    await ethers.getContractAt('TestIBroker', await main.broker())
  )

  const furnace: TestIFurnace = <TestIFurnace>(
    await ethers.getContractAt('TestIFurnace', await main.furnace())
  )
  const stRSR: TestIStRSR = <TestIStRSR>await ethers.getContractAt('TestIStRSR', await main.stRSR())

  // Deploy collateral for Main
  const { erc20s, collateral, basket, basketsNeededAmts } = await collateralFixture(
    oracleLib,
    compoundMock,
    aaveMock,
    aaveToken,
    compToken,
    config
  )

  const rsrTrader = <TestIRevenueTrader>(
    await ethers.getContractAt('TestIRevenueTrader', await main.rsrTrader())
  )
  const rTokenTrader = <TestIRevenueTrader>(
    await ethers.getContractAt('TestIRevenueTrader', await main.rTokenTrader())
  )

  // Register reward tokens
  await assetRegistry.connect(owner).register(aaveAsset.address)
  await assetRegistry.connect(owner).register(compAsset.address)

  // Register prime collateral
  const basketERC20s = []
  for (let i = 0; i < basket.length; i++) {
    await assetRegistry.connect(owner).register(basket[i].address)
    basketERC20s.push(await basket[i].erc20())
  }

  // Set non-empty basket
  await basketHandler.connect(owner).setPrimeBasket(basketERC20s, basketsNeededAmts)
  await basketHandler.connect(owner).refreshBasket()

  // Unfreeze
  await main.connect(owner).unfreeze()

  // Set up allowances
  for (let i = 0; i < basket.length; i++) {
    await backingManager.grantRTokenAllowance(await basket[i].erc20())
  }

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundMock,
    aaveMock,
    aaveToken,
    aaveAsset,
    erc20s,
    collateral,
    basket,
    basketsNeededAmts,
    config,
    dist,
    deployer,
    main,
    assetRegistry,
    backingManager,
    basketHandler,
    distributor,
    rToken,
    rTokenAsset,
    furnace,
    stRSR,
    broker,
    gnosis,
    facade,
    rsrTrader,
    rTokenTrader,
    oracleLib,
  }
}
