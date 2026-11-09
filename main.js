// MAIN PROCESS: window, local data file, automatic daily backup.
const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');
const { createUiUpdater } = require('./updater');

// Keep the client release isolated from the developer/test profile so the
// first client launch starts fresh. Later client releases keep this profile.
const appDataRoot = app.getPath('appData');
const clientProfile = path.join(appDataRoot, 'the-smart-pos-client-v1');
const previousProfile = path.join(appDataRoot, 'the-smart-pos-new');
const currentUserData = fs.existsSync(path.join(clientProfile, 'data.json')) || !fs.existsSync(path.join(previousProfile, 'data.json')) ? clientProfile : previousProfile;
app.setPath('userData', currentUserData);

// Refresh renderer changes and restart the main process while developing.
if (!app.isPackaged) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

// electron-reload starts the replacement process before exiting this one.
// Enforcing the single-instance lock in development makes that replacement
// quit immediately, which can leave the app closed after editing main.js.
// Packaged installs still enforce a single running instance.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit();

let win;
let customerWin;
let customerDisplayData = null;
let running = false;
let cfg = { dir: '', time: '02:00', frequency: 'daily', weekday: 1, keep: 30, on: true };

const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const logFile = () => path.join(app.getPath('userData'), 'backup-log.json');
const licenseFile = () => path.join(app.getPath('userData'), 'license.json');
const TRIAL_MS = 24 * 60 * 60 * 1000;
const legacyLicenseKeys = {
  '12360b601a951d9e579d85656364c5c5123dfa641067161df1ac438071d46f04': 'permanent',
  '843a3a12c70d4c67064561d1e70360ceb01135d40f99898d518abbe0f092c4f8': 'permanent',
  '0bdf99f76d52d7a692051dea9673bdf60de4788be79ad84d5c52c698b3152483': 'permanent',
  'a3fa9aa7947966f954cfaf757d2feef262fe79f224dd90dfe6237f04bc02915b': 'permanent',
  '1e4535011a394ccffc71052ccf866c8038c0401ac99efd909a5f1048fd2b0198': 'permanent',
  '27c763d8ffcdc60e9cec456c408107ae63cdf5d5b2ff3071d4110faea8de8703': 'permanent',
  '68564a165aad483960200a72ac11cb30ab5bfa0f3403c68414304778c69e28c1': 'permanent',
  '324fd466390a1a3fc9f32bf837f0e2be8ae66fbada2bd0f7e693c8419bf0ccf1': 'permanent',
  '8512ee986e16890320749f0bedaf2fe0eda915287a40209a2313485b3f40f767': 'permanent',
  '5bbbadef26870559160907f80dc6a42e09289652495f52ea566e5648ddc3c009': 'permanent',
  '5f629a8addf37aab2cf31957722c8df8bd3a1b29822f2594eda6cd1c6802bff8': 'temporary',
  '3caa6d3d285f33db482da1bccd06620af0f654c302a6fafef5f990145f25b1b1': 'temporary',
  'bf1b6eda19d68049629a758f439f9999dde8d8a3f3406a6f2be9b571223d5f65': 'temporary',
  '3b5c1bcbcb43c266e09a5cc847fd405c84e3fbb373c630ee0615c20a2d0e50cf': 'temporary',
  'c214a443ee98cb41094fb1dc1f1d91e0a2fd0bc4b935fb9f83f6526743a91134': 'temporary',
  'efa32b33d45e5df865da35a0eca83bfd73931518349fef9dd56caa31aa17b759': 'temporary',
  '869bf82dc440eae2b07fe9582b2d5eb0fa4156e7ff088e8310e771f25a6e591b': 'temporary',
  '77dd70ddcea5ca9891ac6c2097564f373c443643d1b088b9ff2690840c3970d3': 'temporary',
  'cc9ee72b2eaf2e88dc9540844c02a8220f81e822a37f3f0adb3ce5bcbc77054e': 'temporary',
  'dd146691e15772a4f366d2b8faae3310b13f13a4a2af898975db2f7cf42038b5': 'temporary',
  'e0de451e2450d10e089882f0bc97dec4451c0790275660feb98e56d518042e0e': 'temporary',
  '544827c1f47518cf36d26c1fc4de8419c4b0e7b20e8349afbe2f305049a35174': 'temporary',
  '31f1d19ba7f67f7c87d2647ead422d395faa1f4598a86374b105b5b901749385': 'temporary',
  'bba85e29c35a066418ace8d32a5627da836658dace743c8034660db54feb19e3': 'temporary',
  '53c571aab3d40651f503b919e3cfc95c9e43ba8cd2483587518b92ef4f7e050c': 'temporary',
  'a9052c9a3d93e1527917f78c579f3567cb3a839735429417152c32c9839abf67': 'temporary',
  '2140d1372bc6012a583440133410d415425ad3274c7411434c4e864119298aa5': 'temporary',
  '9dbbf9d273372f9748b8202e9cc444038bc5c6ad459d8b0ef3f792b673237203': 'temporary',
  '7811ba608ae6f05bbd9a7712efb5c1c1dde8562fedd907d0acac588d74df6b44': 'temporary',
  'a32002ed84fd840f4b22807887da2ad5b3a0cfc38b4d635a0658b042288e1314': 'temporary',
  '6a9483fcba7d6d9893e4c08415644aabe25a1624868ac869acc8bbe3dfbe9d07': 'temporary',
  '411ec94a78938c7304ba90dc281198c1e04b80ffc905c2f6cf47d038becef71c': 'temporary',
  'aa78e2263a3df15be66807f6079d65f3ab09052d1960a678fc8351534a1c8e3f': 'temporary',
  '0c067b91a504ea0018ec53800a728e865ca174f7f85a403c1c8a75df4094a59a': 'temporary',
  '2ee16faa3ee0e1bbac01c8cd916f46e80c35be1804eb8713d09073387d7041c6': 'temporary',
  'df82795859250ee2aa8acac89256de2a5682da8d8ef4355fea5d555c0c2d4168': 'temporary',
  'b83d08abc48129fa0b35835502f52d07ea3baa4f253a0857c83ef0fe50c1f9fc': 'temporary',
  '86dc9006c7aa14919c28d59e85ab9bbecd8169a4b87b04d20fc29d1f6d10b475': 'temporary',
  'f7e5a5c031df93598fc61131addfd4a07c6d8cf2f4ae71cb15859b7a0abbc574': 'temporary',
  'dd7bf1d80c63d6ec3990c8341477806c9459633541fd5502f536fc8476cda836': 'temporary',
  'b6df157af9de3e3de073b517a421ae2f5274801c1d0a84f21be2f82e6ed3b407': 'temporary',
  '0ee58288fe8284e03a586fed08049fbac2762871b2e3b071c63474c738a499c3': 'temporary',
  '5c5b3bf5af8ec5956e8b5883c7113cb1360c3f02b30c35f2563f3bd681475c2d': 'temporary',
  'eda2e4142ae57615fe339d90b34cd8ea609456a60c18d582d1303ea4e98d4edf': 'temporary',
  '911889fb3c2dc64772a15b0ced382a7e70d9eaea19c76e22e6fe57086b8bbe9d': 'temporary',
  'e01ae8102a08a4ea28ac84f522824c6fa5649380dfb229c973aa2e4256c35281': 'temporary',
  'e7b49e649c0411497dd7ab6f41833ab7dfba7f7c8ce84d8ba69af83b39077b2a': 'temporary',
  '468e28e7a8e4da8f58522022ce08b5314fc01f695739b6f674a036d9e5710aba': 'temporary',
  'f877040d19f5812ec9ecfab020e080cd81b0cdcfa1f844c2f1241d11a2683229': 'temporary',
  'c274d5debd03a3ef757333c8323af040194f26745edbd9208169238cc612e208': 'temporary',
  '7f7ef442340f1368dc85d1f860a4b09d8dd64d4239553e44cebcd8326940b68e': 'temporary',
  'c1ec1a39c9ea78f97130c9b106c3ae9951bd6ba53a4988e5e2e1a166d91b290a': 'temporary',
  '7aebb8b5295d60f2f0b2406ab31f9af0a15cbc49bc9ed1d7932704d19bd0fe00': 'temporary',
  '59cc890ec03e9ac946685dfe1cec624009a87c44eba240fa9552e48797a35105': 'temporary',
  '8ffe3babbc987d3ef2de7bf6a3905ee9fefd4d0b749ec12971e0d1c32b94df2d': 'temporary',
  '41d2ca55ce12146d026c4c89de597cb3563d943eede9044c3e8eb4ddd1f4320e': 'temporary',
  'a84d51c194e02dd371baa0b0fbb05fd554e32bbd000bb7f2427a32a6919cacb4': 'temporary',
  '6e5deb4c9e184f93917d88866f1ec26f53b598bc4c41143950dbaa784605ac34': 'temporary',
  '31973e9df1b5518c6558dc256d6eec280d7744044b955cf3313e2044d361f10d': 'temporary',
  '284c33f077613449c028cea2ec8c089ad6a3ec42112dbf29ea761da64f7d1d6a': 'temporary',
  'bf1a9127f0b72f7a4f17b60ca16d8026867e5fcc1efb2c41d342c22d739c0b52': 'temporary',
  'e2dd9553be82c51e7781cb204a685800982cf4773eb13c809cb682e559075dd7': 'temporary',
  '5f1f64aa8e825708ed205584661fd68a8088c866a2d2986f164a69e33ec0a5cc': 'temporary',
  'b92f723db2594932489d42c80d9df6fb3f6c559e7f23a119120374db81ee85ca': 'temporary',
  '4b2444c9e8a5b37d5d48b30830ad50b3083ea27a7be3e9c87add01c35094ffea': 'temporary',
  '5936f29356fdff27a97886c3f321c096b1ac44c5edeb356cad0d7f4464198496': 'temporary',
  '3c2b6e2d9371e377a5a132fe62a11bb72dd96f4d2e3880ef05d81813cfb5b647': 'temporary',
  'c882aaf322bbd3d84c64f840510607a49ad684a67e8e76f85fb795ad81113e6c': 'temporary',
  '0be9bbb8175e6c33719a74049140ddb21eed4c695ed44e3f973f2f651f99ce13': 'temporary',
  'e8a6ae38c515ad8f81fe08c96940eac371fcf11d74128b3c2e3e48b9c1e5f8c8': 'temporary',
  '0a32a6b92e5fc36e63461dba77b25303e6668373f05245ec550ddbf6c54928e5': 'temporary',
  '0f7d7c2cdd1abca28ee6e1c1e2e5d914bb650b53cfafa13d5360d817b639854a': 'temporary',
  '446089561496d3fb5e8c08334e3254084aa0b71611fb2cbbdbe6eb5021725e21': 'temporary',
  '7125e34877af140d7c7555d973a0807218659ffee4aaa64fccc36ae0da94003e': 'temporary',
  '45c93de87bbdbeeb401d3619928be54fbbe8c32decd78a9c1dcb4df22aabb2fe': 'temporary',
  '5f1ef62ec6fa4be3955208aacf60b2bd4c01d34a5e21b1b013d1b59a2506f87a': 'temporary',
  '69d53fc0e37d95a9a562dd048ba1a0288ff254d5c6773aa3ceb432b4af979e04': 'temporary',
  'c6e3ebe52ca4832851a44379649b6733d2d6a71b25570940d087bc55c162286f': 'temporary',
  'f89992706fbbf6c6d364c9dfe1441f926943081cfae982d8f5b56da2991263bb': 'temporary',
  '7bf81bca33b3f73dca6f2bcb91fb321fc6045c98c07426a76899230b7b4e7f67': 'temporary',
  '4603601f0b8acb21726e7cb0fbc8ce4d3176697333a28a7ed9071c8c358821df': 'temporary',
  '3f469fd82fd05ecbb9e90ea2309349ab1cd7eda3dfd107e6e60f931178fa6a21': 'temporary',
  '381f194dd0410e0743873ca33cbe08ed95466bfe12529d040fcb894c972fcc24': 'temporary',
  '2122853d5960c00c50dcd338d277a41655ca709f420e8245b13a1edc9cdb5f72': 'temporary',
  'a4be503d82996ce3878be2bf09367293f649bc4f7209db664e32beee967e9b33': 'temporary',
  '0dad7d361e2e6bc554e9098d80b101402dd65d5134f567f7d499f7ee8fd48164': 'temporary',
  'af44898b5d519b6d23961b1e6e9adb1d2df91d4d7de49333e361a29a6724857c': 'temporary',
  '8741d84bd36dc34e0bceef20fa836799922fde17cad40f0fea8585ad5d6966f4': 'temporary',
  'ff4a1a67bd24f917117700e0c1cdcfa48ed96a336e01cb9ad50cfee9f7e0a228': 'temporary',
  '421a8718ebd742b3702710970753418e0f04e274b2f359ef762e4f3d2446c0b2': 'temporary',
  '1e368c8ab578d514293040fc7ab444c1328e655ae6de922168d428b2c3795e01': 'temporary',
  'ef02f6e6bd9e4e857e5c4ebe47437a335376ebd9ab289276d77de4e342181c0d': 'temporary',
  '9962d47b8cfba13cc4f60bd70b3f7ba831a197fee2c17c86f3f4306de340e8c6': 'temporary',
  'd50611f42c5803b6f329d7b1838f2f160cbb5ba6a72ca560a3a32135c8da8ad1': 'temporary',
  '9fbc483b6083f19628d9c32ad506b86152c2ca64f2d935bee7e5b22020b63316': 'temporary',
  '30f6258ee62e13dd9b9cdb9e61c82469dd00ca7daef870943c5f33900cba089f': 'temporary',
  'c136712f372e0ad0a8c1682197b8360e5b4e993e376448d7732cf7d772f9d2e6': 'temporary',
  '11386997adc21f9f4ab9c4fd7fbd98bfd526659ae8e4ff08edd7d59f7cad3d3e': 'temporary',
  'cd109b6e5761f04e3d05369875137bec6e83e834edcfc69b30413ac10c4b00d3': 'temporary',
  '26eda6d842cb7a678fbdbe2a86befda98f2950a3b7ffddaa9a32f701b6375b89': 'temporary',
  'c5ef6c4884c8eb2d2cdd6dfbd024878c25461d30ab3bfecb5f7a30617d493adf': 'temporary',
  'ed1422823e407cfd73bd97f04828aac063d23e1baf89ef08c00f77340e7cd1f1': 'temporary',
  'da173430cf265b92f07c786cb15ddf57499f452ce053f1a08eb262d0b9277f84': 'temporary',
  '2ccb8ff70b5f81d45a80bd1183dd4fcad30b42ef3d4ce858b5c06cdd0d8a22fc': 'temporary',
  'de69f84d5f8c1e86af3634264e419e6d7f9306c10073f45f6ac32ee41570b494': 'temporary',
  '07e491625ddeb60400a99dea79e81efc0a359d51ccd46343017894dfdefad226': 'temporary',
  'f66a3bb9ec0642e0ccd07da6c42b605d5094bf5615359fb5fc33eb1b3c14daad': 'temporary',
  '664b845eb26d98bf9785c07f87328d22d49206ae890ff283a79d5891dfe0b5c3': 'temporary',
  '7ab19916e713dbc5286666ac1f6472e05e7a290002bf3c78fd8bbf20b265213f': 'temporary',
  '63460cea29d99c531e7b3b5c220180fc30d2311c385ef1370bc9797e32a0344d': 'temporary',
  'b05cd1a7b9c48c746126b4e2b0f1915ed0bf98a4d36cc7943158e6d4f5d892e5': 'monthly',
  'c7814f96e3bd726cd063bf72853b97259bef84c475421f0589d8ad58ecd1ee33': 'monthly',
  'a2248c30b5ca38f11380e7068fdeec69572a90d4d9b9e3611a353cff37b2e076': 'monthly',
  '34008201a067d08361b8d961b81b720f0b40b958c23698bfee243004457ddac1': 'monthly',
  'eef8327c51ebca900826cfd505d9e26c3e06b30b99dbda139149fbd03974d0b9': 'monthly',
  '72fa157d024861fbaef389843d87684c64538d2dfffc1789fd27fe510a145c0a': 'monthly',
  '1ff8f69e3d4b091a01a7b12902c89331fb4701f98e1a5a54ccbe8d521f0e95d2': 'monthly',
  'e1023be260f558971b6a18ddf41521a1020f3e3939b15ee99910cb6ada6bb0c5': 'monthly',
  '414b299cde8686795231999c494a8eb281c4783d6580459fe33cbc15aab2db9b': 'monthly',
  '7885bd19ba87e91b077166df4ad27765f3de5091fc023681fb9bd8470ffde6b7': 'monthly',
  '1b00b4c44fb2763e79a78901bc456c032c37882114927b7a916e22591b6d2de4': 'monthly',
  '236575e0338a769d1c5445a01fbdc42f4d160f4d98f67b197bb1cbf67a089237': 'monthly',
  '1cf50a0e466ecf7b3d4714eed1b0055d1b11ae6cd7807a38a9827578f3d5796c': 'monthly',
  '4a88ee85e865f7594b2cd32cfedff56263cfe4746e029b860602cff543e96a11': 'monthly',
  'f38dcbb5d7724b864b05a8d8f39dd1ec45c4f3f7b9c22a9ed8e4a167445428e6': 'monthly',
  '1302c01891a0275d0b547ee15784758ad247ef973ccde843cea23a4a3d7cfa47': 'monthly',
  '47650f21dd1036dcbed716c7c94d751c0cfb93d03fa0f55288600260bd54bf18': 'monthly',
  '59ef2739a7a93329f7923511c400211693c42290a009ff903655840fc72e7150': 'monthly',
  'dda8bbab12827cfd867e0fbe578f65aa1543364d032664e1219f13fbc20aa48c': 'monthly',
  '076c996e4e7448343dd02cb124d1a7a84b6e67da124d83126834792450728888': 'monthly',
  '25b2095298f1d8d3e4290ad0488414781a65557b5ff7e260f436b598d82afc0f': 'monthly',
  '753a28610b58e4814a32f71811bc84a9446ea48759792c1b2333b4a076b4ca5c': 'monthly',
  '35acc54bb2422b009392413337929ea58143f2ef76ff9fb3131021eef3910e58': 'monthly',
  '375440230de8375f6da3d66e4e273fd5f4fdc5ca43cf4a3f8c17cf4c810ce5c7': 'monthly',
  '7836d9606ba5306e4e3e79ce4de3000c73ae0bceeb03f58122a7b34c3e25f6a2': 'monthly',
  'f08a5811819a1260e7ab33ec61d7b2f461b503dd85321e6452a7631d5274141f': 'monthly',
  'ec897cd99c0d628af9a900646da32747fb3f2ba1d7225881b24ece29159b9adb': 'monthly',
  '7481fbfeb41886af0efaecf746c6a9a1165a5194e596f7ba07280bb2c3e5ff85': 'monthly',
  'd6f5dd519c8905f52034878b1a5b04870fb7c7d503aceb2129d7430447f88b64': 'monthly',
  '9ace7d53e3a10c3ac1ef9762a194a80049d7a984c9b537a772206e7ef1c4e179': 'monthly',
  '8bcd9045d39b211956e7bc9709871a6707750cee52a028f2bdfde547c5700174': 'monthly',
  '776e5561d4969def7534a0d4df0f3da48772e845883008ede1857ab2ef98133e': 'monthly',
  '9abda3f9bc5fb22b67b57fcd09a70633f2bb48f43b6cec898ca96dd3964a022e': 'monthly',
  'f9d2e0fc8813aa0e08a97027ae28244675148f3c57ed7ca1cfaf49ed7a89ed0b': 'monthly',
  '6f1096b9fe78c7ff693196a874c60a5023e76e8140095ef6b8443659a74eff55': 'monthly',
  'e2c7581cca1b0e9e1c9ddb4bb95422c58c63937fa1ca2916fb81fcf50e3c766b': 'monthly',
  '6fe228d47d2d2d96142a73630dde40f52bbdf57c4aa10fa6fe25942b3586ad21': 'monthly',
  '22d12accaa04640e156ff7888c46f9054d9584ce50f1f3ad55b80571909c34d0': 'monthly',
  'a7ac6d262e8b5cd43b47e5b27116a1e09c43080fd2b5abe7b234d6ae761cc1df': 'monthly',
  '77f768ac56d3cc46e35c60b0bb72e6d833f58262048a937a5bb95ca0ba8b80dd': 'monthly',
  '5fadffb61e923bc49a3c05d207b53799b65dfd1bd543c26c731e1e33feb48d22': 'monthly',
  'db918ca5210db3ac158eee1a76b6837d0c8022bb2dc8ddfb41571b87557885c9': 'monthly',
  '47ec34bab54fa7637eaef0f18b8033fb062b9ed3eb6adad4c03dd3b00930d3df': 'monthly',
  '08d950ecbff1cdfcfec2a4080b0e761225d0450c99b20e2bd89df49f19f91910': 'monthly',
  '8064c286103501801f5e54a6402c3f4d16c6079b76ac8c963d4c8724b884f263': 'monthly',
  '6f01caa91a44e5a15cb3d10a1030503d3503f0fafc436e172ab551c90c545a6b': 'monthly',
  'c6cf4baffac407d3d4579158de378ec51b416916f21b7dc580b5a5d75342e848': 'monthly',
  '0ffb7790a6a185ac687e829837d40435d3a00bd4c11eae71a885a87ffc57a080': 'monthly',
  '13c2e192382e95356a42b25302cbacdccdf80e75472eb6ab4b152e5cadde9381': 'monthly',
  '299fca93b91cc47709b84eaf0a646cbff01f4646cc5230531677da43248ac337': 'monthly',
  'a7ae8892095a23ef24b9040a46fa9c4e9883db5bf5e97f1e81c6fdc955e91835': 'monthly',
  '7a4e4c078969efef9c8072c75b624d29eb2028972e539baa6870207ba65baaa0': 'monthly',
  '3633f1d0688e54a4a3ee6e87a6750c70b5ba98eb9e288123b9e0359c5b8b8b76': 'monthly',
  '882bb1f37ee9892083b211e4277cdd155e5605ab706a175f99b0d48d04c88416': 'monthly',
  '265b8a2931e064e2e5e3e33211f8321ba3b64af9ce52ee688d0218b4d6c281c5': 'monthly',
  '735f18602512abec2d45139cb56da7a9f88978df47fdb5e12a2764d0e584c105': 'monthly',
  'a3a2bf8eb1a13d12263bfd9f668a640af225893d76b43a4382405fd419b68757': 'monthly',
  'f3cfb07d27e222db4c8d1fac55f37b3940ea9865d31319fd4d7d6feb724242f5': 'monthly',
  'a61b80763cdd0fca123997ad875c032de5dc607457db28dec526bb48d67612b3': 'monthly',
  '0de997c579e04ed3cc54094d99a971808e597014ccaf1a0a29ec0c47464ee9b9': 'monthly',
  '169b2b1446bae37b4c1d4a4b74af8f0d5ed4fcc2682e262decabc8ae3ed420d5': 'monthly',
  '88b111fa0361e3ee31bca89f6b8dc7c68691616ff20175a689292863930d266f': 'monthly',
  '52028861208825c95660693ebced567c876836c5bf238f5a7045b0464fd95f1c': 'monthly',
  '0660b6fca5c756dd40ac4371183c01d311130d94288b3a2f8ba574ade8cc12d5': 'monthly',
  '36006085c368592a3d3e4f87369171ce07073528cba8dd88ca39fb30f0fbbd02': 'monthly',
  'f650cd0d7ef82f756cb565cc3bf35707b00cfc75948b6f606183e8fe8ddad653': 'monthly',
  'a7863c3ad84cb3ec2220251a1e91cb9b93429eb73c9395673dbe822c04ea5a5b': 'monthly',
  'aa3b042f3f76715b423f1f6243ac37b62613a1d28dc970cb1aebd5a9333e236a': 'monthly',
  'eee0e7216ef58e44f688c73e2be9406f01f650c4cdd59b2d18581999c7ca42ad': 'monthly',
  '90faf0b130700e534e58bc43565efdb1cfc73c708d3f40216b743743dc5bc97f': 'monthly',
  '76320eee9a05c392d51843aeaf5f85882403af26dd5045371eadf3849b8bed1a': 'monthly',
  'a7fe1f397201157ce32e55661dec900ddc19466eca367b65d19613b34d919210': 'monthly',
  'd85a0541401bf5ddb832371db0179b5d86f3c728720ed6dc9270cad5e5c6ed75': 'monthly',
  'c3189822fc8dfb604fc14f03bf34207aa41406ddeef541113f0d3bb45c5966b9': 'monthly',
  '05f37aa91a441521a22a0415e2f919a2196b8cd498bb447024964f72ffe17c95': 'monthly',
  '065a28224d2e28005a0cc3cecd74db129069733bc4c710a78dcf88c31fc621b7': 'monthly',
  '175f0e144312ac2d3682d70233fb742c36d2722790109d541d0bd04f9116dbc2': 'monthly',
  '119534cf27e21733b4fb45ea3d11d86d334bc8e5ae372f9f2b258e3df9303249': 'monthly',
  '61baa0ab60286ebead80564ba6324e206b7317c13ac7f25c0076321870b45004': 'monthly',
  '020ff7594cfaf3d47657b258f5d5cdbcde082be090dcd95fc792cb01dac81ea8': 'monthly',
  '5817c1a7fc6b245f26ab82e5c66817e05e56b8b446516a29936297edf8c5438a': 'monthly',
  'a3ac3c507fa4f60fe5947f41537b5f0e0914ea876f6186f8538ccb89902e273d': 'monthly',
  'c878feaa27604faa1b1f56e3f60b65ffba83f28a61cef98b32df6c8b190bd0ed': 'monthly',
  '155966204303f9fd0409a18424b74ff3f5bb01b683b08c417779f38e75c5847b': 'monthly',
  '74c0b006645fc5db2992239d374c4286e248f505d282cc4d761543f80fd596a3': 'monthly',
  '623c3a21d30b9fad58788a304f99912479898647300ae7d53f245eb094f3cd01': 'monthly',
  'e8b97a4e9023a3ac1aaa781271f3bdf1d650ecfc01f4a0bfd0f44b238f54d819': 'monthly',
  'd39c52a2c1be21ba35276986bbe82f061a211fabc55b0432a0223ada83331c14': 'monthly',
  '3226f8844e65c30ff687fca6abd2307addc2000c0287e9e7e71bb2c3fe49ce2f': 'monthly',
  '040d2c0340499528aaeb92962f685762b0af81d5cf8a4e9bad8178fd7a24a769': 'monthly',
  '61af2359168a6a3f9fe31e114cdd6a343e8df7076c41e9d872e8e08ab6eab466': 'monthly',
  'b3c7550a4b0d327bc70b59cf2373645d66f6eaf72442b800a03f3b9cb3b443c5': 'monthly',
  '16045fd3445d1811231a8d2b8c20cb8c10af6f8d8683067f8c25dee978a2aeaa': 'monthly',
  'a482cb0704029124ddb3164ac0d053f5a27a60fe6273a255235a83103cf94d57': 'monthly',
  '7ddc14ab74cdf4b32c52b13275f8ab1653579d829b24c14b6017b3758707afbb': 'monthly',
  'f53dd085b0210151f0cadc11718c07194bb584363d38ecccae155125b6d10621': 'monthly',
  '2240ccc2883237f944bbe87174f2fd78a04930bca935cd05d157abb3f105ccfd': 'monthly',
  '7df0295ae9fce5b15362dde1cc683558441e84a42299df6949d42d8bdb464ed8': 'monthly',
  'e27431d381bc2c4582225357086a54491801ff7d57255755b39928adb004dbf0': 'monthly',
  'a6402babef1f91895a5e309ea04710dd21508febb35a49ff5a024ff95ed501c4': 'monthly'
};
// Public key for signed desktop entitlements. The matching private key belongs
// only in the live server's DESKTOP_LICENSE_PRIVATE_KEY environment variable.
const desktopLicensePublicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcYczFMBcXHZEIObs/mV0YSm5ouqFrkOtKJQqzRBUe7I=
-----END PUBLIC KEY-----`;
function readLicense() { try { return JSON.parse(fs.readFileSync(licenseFile(), 'utf8')); } catch { return null; } }
function writeLicense(data) { fs.mkdirSync(path.dirname(licenseFile()), { recursive: true }); fs.writeFileSync(licenseFile(), JSON.stringify(data)); }
function desktopLicenseType(kind) {
  // The issuer uses descriptive names; accept the numeric names used by the
  // first SP1 client builds as well so keys from either build remain valid.
  return ({ '7': 'temporary', temporary: 'temporary', '30': 'monthly', monthly: 'monthly', permanent: 'permanent' })[String(kind)] || null;
}
function licenseStatus() {
  const l = readLicense();
  if (!l || !l.startedAt) return { initialized: false, active: false };
  const now = Date.now();
  if (l.signedEntitlement) {
    const { encoded, signature } = l.signedEntitlement;
    try {
      if (typeof encoded !== 'string' || typeof signature !== 'string' || !crypto.verify(null, Buffer.from(encoded), desktopLicensePublicKey, Buffer.from(signature, 'base64url'))) return { initialized: true, active: false, type: 'invalid' };
      const entitlement = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const type = desktopLicenseType(entitlement.kind);
      const timed = type === 'temporary' || type === 'monthly';
      const duration = type === 'temporary' ? 7 * 86400000 : type === 'monthly' ? 30 * 86400000 : null;
      const expiryMatchesKind = timed
        ? Number.isFinite(entitlement.issuedAt) && Number.isFinite(entitlement.expiresAt) && entitlement.expiresAt === entitlement.issuedAt + duration
        : type === 'permanent' && entitlement.expiresAt === null;
      if (entitlement.v !== 1 || !type || !expiryMatchesKind || (entitlement.expiresAt && now >= entitlement.expiresAt)) return { initialized: true, active: false, type: type || 'invalid', expiresAt: entitlement.expiresAt || undefined };
      return { initialized: true, active: true, type, expiresAt: entitlement.expiresAt || undefined };
    } catch (_) { return { initialized: true, active: false, type: 'invalid' }; }
  }
  if (l.type === 'permanent') return { initialized: true, active: true, type: 'permanent' };
  const isTimedLicense = l.type === 'temporary' || l.type === 'monthly';
  const duration = l.type === 'temporary' ? 7 * 86400000 : l.type === 'monthly' ? 30 * 86400000 : TRIAL_MS;
  const expiry = (isTimedLicense ? l.activatedAt : l.startedAt) + duration;
  return { initialized: true, active: now < expiry, type: l.type || 'trial', expiresAt: expiry };
}
ipcMain.handle('license:status', () => licenseStatus());
ipcMain.handle('license:start', () => { if (!readLicense()) writeLicense({ startedAt: Date.now(), type: 'trial' }); return licenseStatus(); });
ipcMain.handle('license:activate', (_e, raw) => {
  // SP1 signatures and payloads use case-sensitive base64url. Preserve the
  // supplied text for signed keys; legacy TSP keys remain case-insensitive.
  const suppliedKey = String(raw || '').replace(/\s+/g, '');
  const legacyKey = suppliedKey.toUpperCase();
  const type = legacyLicenseKeys[crypto.createHash('sha256').update(legacyKey).digest('hex')];
  const l = readLicense() || { startedAt: Date.now() };
  if (!type) {
    const parts = suppliedKey.split('.');
    if (parts.length !== 3 || parts[0] !== 'SP1') return { ok: false, error: 'Invalid license key format. Paste the whole key without spaces or line breaks.' };
    try {
      const [, encoded, signature] = parts;
      if (!crypto.verify(null, Buffer.from(encoded), desktopLicensePublicKey, Buffer.from(signature, 'base64url'))) return { ok: false, error: 'License signature does not match this app build. Install the latest desktop build.' };
      const entitlement = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const mappedType = desktopLicenseType(entitlement.kind);
      const timed = mappedType === 'temporary' || mappedType === 'monthly';
      const duration = mappedType === 'temporary' ? 7 * 86400000 : 30 * 86400000;
      if (entitlement.v !== 1 || !mappedType || typeof entitlement.id !== 'string' || !entitlement.id || typeof entitlement.nonce !== 'string' || !entitlement.nonce || !Number.isFinite(entitlement.issuedAt) || (timed && (!Number.isFinite(entitlement.expiresAt) || entitlement.expiresAt !== entitlement.issuedAt + duration)) || (!timed && entitlement.expiresAt !== null) || (entitlement.expiresAt && Date.now() >= entitlement.expiresAt)) return { ok: false, error: 'This license key is invalid or expired' };
      writeLicense({ ...l, type: mappedType, activatedAt: entitlement.issuedAt, signedEntitlement: { encoded, signature } });
      return { ok: true, status: licenseStatus() };
    } catch (_) { return { ok: false, error: 'Invalid license key' }; }
  }
  writeLicense({ ...l, type, activatedAt: Date.now() });
  return { ok: true, status: licenseStatus() };
});

// Updates are published as a JSON manifest and platform installers on the
// configured HTTPS deployment. Download to a temporary folder, verify the
// digest, then let the platform installer replace the app and relaunch it.
const UPDATE_TIMEOUT_MS = 15000;
function httpsRequest(url, { timeout = UPDATE_TIMEOUT_MS, onResponse } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('Invalid update URL')); return; }
    if (parsed.protocol !== 'https:') { reject(new Error('Updates require a secure HTTPS address')); return; }
    const req = https.get(parsed, { headers: { 'User-Agent': `TheSmartPOS/${app.getVersion()}` } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const redirected = new URL(res.headers.location, parsed);
        // Static hosts often redirect artifact URLs to a CDN or object store.
        // Permit HTTPS redirects across hosts, while never following a redirect
        // to plaintext HTTP. The installer digest is verified after download.
        if (redirected.protocol !== 'https:') { reject(new Error('Update redirect must remain on a secure HTTPS server')); return; }
        httpsRequest(redirected.toString(), { timeout, onResponse }).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Update server returned HTTP ${res.statusCode}`)); return; }
      onResponse ? onResponse(res, resolve, reject) : resolve(res);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Update server timed out')));
    req.on('error', reject);
  });
}
function compareVersions(a, b) {
  const parts = v => String(v).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map(x => Number.parseInt(x, 10) || 0);
  const av = parts(a), bv = parts(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return 0;
}
function updatePlatform() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return `win32-${arch}`;
  if (process.platform === 'darwin') return `darwin-${arch}`;
  return `${process.platform}-${arch}`;
}
function findUpdateRelease(platforms, platform) {
  if (!platforms || typeof platforms !== 'object') return null;
  const aliases = {
    'win32-x64': ['win32-x64', 'windows-x64', 'win-x64', 'win32', 'windows', 'win'],
    'darwin-x64': ['darwin-x64', 'macos-x64', 'mac-x64', 'darwin', 'macos', 'mac'],
    'darwin-arm64': ['darwin-arm64', 'macos-arm64', 'mac-arm64', 'darwin', 'macos', 'mac']
  };
  for (const key of aliases[platform] || [platform]) {
    const release = platforms[key];
    if (release && typeof release === 'object' && typeof release.url === 'string' && /^[a-f0-9]{64}$/i.test(release.sha256 || '')) return release;
  }
  return null;
}
// ---------------------------------------------------------------------------
// Two update channels share one manifest (public/updates/latest.json):
//  1. LIVE UI UPDATE  : small, verified download of the changed screens (renderer/ files).
//                       No installer, applies in seconds. Used for the daily updates.
//  2. INSTALLER UPDATE: full installer for the new desktop shell (main.js, Electron...).
//                       Only needed when main.js / preload.js / Electron itself changes.
// ---------------------------------------------------------------------------
const DEFAULT_MANIFEST_URL = 'https://pos360live.vercel.app/updates/latest.json';
const resolveManifestUrl = url => {
  const value = String(url || '').trim();
  return !value || /YOUR-VERCEL-DOMAIN/i.test(value) ? DEFAULT_MANIFEST_URL : value;
};
const uiUpdater = createUiUpdater({
  stateDir: path.join(app.getPath('userData'), 'ui-updates'),
  bundledDir: path.join(__dirname, 'renderer'),
  shellVersion: app.getVersion(),
  packaged: app.isPackaged,
  request: httpsRequest,
  compareVersions
});
const rendererFile = name => path.join(uiUpdater.resolveRendererDir().dir, name);

async function fetchManifest(manifestUrl) {
  const target = new URL(resolveManifestUrl(manifestUrl));
  target.searchParams.set('t', Date.now()); // never let a proxy serve an old manifest
  const res = await httpsRequest(target.toString());
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) throw new Error('The update manifest has an invalid version');
  return manifest;
}
function reloadWindows() {
  if (win && !win.isDestroyed()) win.loadFile(rendererFile('index.html'));
  if (customerWin && !customerWin.isDestroyed()) customerWin.loadFile(rendererFile('customer-display.html'));
}

ipcMain.handle('update:check', async (_event, manifestUrl) => {
  try {
    const manifest = await fetchManifest(manifestUrl);
    const newer = compareVersions(manifest.version, app.getVersion()) > 0;
    const release = findUpdateRelease(manifest.platforms, updatePlatform());
    let ui = { supported: false, available: false };
    try { ui = uiUpdater.evaluate(manifest.ui); } catch (e) { ui = { supported: false, available: false, error: e.message }; }
    // A published-but-unbuilt installer must not block the live UI update.
    const installerError = newer && !release ? `No valid installer is published for ${updatePlatform()} yet.` : '';
    return {
      ok: true, currentVersion: app.getVersion(), version: manifest.version, available: newer && !!release,
      installerError, notes: String(manifest.notes || ''), release: newer ? release : null, ui,
      uiRevision: uiUpdater.currentRevision()
    };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:status', () => ({
  shellVersion: app.getVersion(), platform: updatePlatform(),
  uiRevision: uiUpdater.currentRevision(), uiSource: uiUpdater.resolveRendererDir().source,
  uiHistory: uiUpdater.history()
}));
ipcMain.handle('update:ui:download', async (_event, manifestUrl) => {
  try {
    const manifest = await fetchManifest(manifestUrl);
    return { ok: true, ...(await uiUpdater.download(resolveManifestUrl(manifestUrl), manifest.ui)) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:ui:apply', () => {
  try {
    const r = uiUpdater.apply();
    if (r.source !== 'live') throw new Error('The downloaded screens could not be activated');
    // On Windows/macOS app.relaunch() may start the replacement before this
    // process releases the single-instance lock. Start a tiny detached
    // handoff instead: it waits for this PID to exit, then launches the app.
    // The new process promotes pending.json during its normal startup path.
    if (process.platform === 'win32') {
      const script = path.join(app.getPath('temp'), `TheSmartPOS-relaunch-${process.pid}.cmd`);
      fs.writeFileSync(script, `@echo off\r\n:wait\r\ntasklist /FI "PID eq ${process.pid}" 2>NUL | find "${process.pid}" >NUL\r\nif not errorlevel 1 (timeout /t 1 /nobreak >NUL & goto wait)\r\nstart "" "${process.execPath}"\r\ndel "%~f0"\r\n`);
      spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      const script = path.join(app.getPath('temp'), `TheSmartPOS-relaunch-${process.pid}.sh`);
      fs.writeFileSync(script, `#!/bin/sh\nwhile kill -0 ${process.pid} 2>/dev/null; do sleep 1; done\nexec ${shQuote(process.execPath)}\n`, { mode: 0o700 });
      spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    }
    app.quit();
    return { ok: true, revision: r.revision, restarting: true };
  }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update:ui:ok', () => { uiUpdater.confirmBoot(); return true; });

// Installer scripts. They run detached after this app quits, replace the app,
// and ALWAYS reopen the POS (the old version if the update failed).
const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
const shQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const MAC_INSTALL_SCRIPT = [
  '#!/bin/sh',
  'LOG="$HOME/Library/Logs/TheSmartPOS-update.log"',
  'exec >>"$LOG" 2>&1',
  'echo "== update started $(date)"',
  'ARCHIVE=@@ARCHIVE@@',
  'TARGET=@@TARGET@@',
  'WORK=@@WORK@@',
  'MOUNT=""',
  'detach() { [ -z "$MOUNT" ] || /usr/bin/hdiutil detach "$MOUNT" -force >/dev/null 2>&1; MOUNT=""; }',
  '/bin/mkdir -p "$WORK"',
  'i=0; while /usr/bin/pgrep -f "$TARGET/Contents/MacOS" >/dev/null 2>&1 && [ $i -lt 30 ]; do /bin/sleep 1; i=$((i+1)); done',
  'case "$ARCHIVE" in',
  '  *.dmg)',
  '    MOUNT="$WORK/mnt"; /bin/mkdir -p "$MOUNT"',
  '    /usr/bin/hdiutil attach "$ARCHIVE" -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" || { echo "attach failed"; MOUNT=""; /usr/bin/open "$TARGET"; exit 1; }',
  '    SRC="$(/usr/bin/find "$MOUNT" -maxdepth 2 -name "*.app" -print -quit)" ;;',
  '  *)',
  '    /usr/bin/ditto -x -k "$ARCHIVE" "$WORK/x" || { echo "unzip failed"; /usr/bin/open "$TARGET"; exit 1; }',
  '    SRC="$(/usr/bin/find "$WORK/x" -maxdepth 3 -name "*.app" -print -quit)" ;;',
  'esac',
  '[ -n "$SRC" ] || { echo "no .app in archive"; detach; /usr/bin/open "$TARGET"; exit 1; }',
  'OK=0',
  'PARENT="$(/usr/bin/dirname "$TARGET")"',
  'if [ -w "$PARENT" ]; then',
  '  BACKUP="$TARGET.update-backup"; /bin/rm -rf "$BACKUP"',
  '  [ ! -d "$TARGET" ] || /bin/mv "$TARGET" "$BACKUP"',
  '  if /usr/bin/ditto "$SRC" "$TARGET"; then OK=1; /bin/rm -rf "$BACKUP"; else [ ! -d "$BACKUP" ] || { /bin/rm -rf "$TARGET"; /bin/mv "$BACKUP" "$TARGET"; }; fi',
  'else',
  '  /usr/bin/osascript -e "do shell script \\"/bin/rm -rf \'$TARGET\' && /usr/bin/ditto \'$SRC\' \'$TARGET\'\\" with administrator privileges" && OK=1',
  'fi',
  'detach',
  '/usr/bin/xattr -dr com.apple.quarantine "$TARGET" >/dev/null 2>&1',
  '[ "$OK" = 1 ] || /usr/bin/osascript -e \'display dialog "The update could not be installed. The previous version of The Smart POS was kept. Please contact support." buttons {"OK"} default button 1\' >/dev/null 2>&1',
  '/usr/bin/open "$TARGET"',
  '/bin/rm -rf "$WORK"',
  'echo "== update finished ok=$OK"',
  ''
].join('\n');
const WIN_INSTALL_SCRIPT = [
  "$ErrorActionPreference = 'Continue'",
  "$log = Join-Path $env:TEMP 'TheSmartPOS-update.log'",
  "Start-Transcript -Path $log -Force | Out-Null",
  'try { Wait-Process -Id @@PID@@ -Timeout 40 -ErrorAction SilentlyContinue } catch {}',
  'Start-Sleep -Seconds 1',
  '$code = 1',
  "try { $p = Start-Process -FilePath @@INSTALLER@@ -ArgumentList '/S' -PassThru -Wait; $code = $p.ExitCode } catch { Write-Output $_.Exception.Message }",
  "Write-Output ('Installer exit code ' + $code)",
  'Start-Process -FilePath @@APP@@',
  'Stop-Transcript | Out-Null',
  ''
].join('\r\n');

ipcMain.handle('update:download', async (_event, manifestUrl, release) => {
  try {
    if (!release || typeof release.url !== 'string' || !/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw new Error('Invalid release information');
    const base = new URL(resolveManifestUrl(manifestUrl));
    const downloadUrl = new URL(release.url, base);
    if (base.protocol !== 'https:' || downloadUrl.protocol !== 'https:') throw new Error('Installer and manifest must use secure HTTPS addresses');
    const filename = path.basename(decodeURIComponent(downloadUrl.pathname)).replace(/[^A-Za-z0-9._-]+/g, '-');
    if (!filename || filename === '.' || filename === '/') throw new Error('Invalid installer filename');
    if (process.platform === 'win32' && !/\.exe$/i.test(filename)) throw new Error('Windows updates require an .exe installer');
    if (process.platform === 'darwin' && !/\.(dmg|zip)$/i.test(filename)) throw new Error('macOS updates require a .dmg or .zip installer');
    if (process.platform !== 'win32' && process.platform !== 'darwin') throw new Error('Installer updates are supported on Windows and macOS only');

    const updateDir = path.join(app.getPath('temp'), 'TheSmartPOS-Updates');
    fs.mkdirSync(updateDir, { recursive: true });
    // Remove leftovers from earlier updates (older than a day).
    for (const old of fs.readdirSync(updateDir)) {
      try { const p = path.join(updateDir, old); if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const stamp = Date.now();
    const dest = path.join(updateDir, `TheSmartPOS-${stamp}-${filename}`);
    const hash = crypto.createHash('sha256');
    let downloadStarted = false;
    try { await httpsRequest(downloadUrl.toString(), { timeout: 180000, onResponse: (res, resolve, reject) => {
      downloadStarted = true;
      const out = fs.createWriteStream(dest, { flags: 'wx' });
      res.on('data', chunk => hash.update(chunk));
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (hash.digest('hex').toLowerCase() !== release.sha256.toLowerCase()) { fs.rmSync(dest, { force: true }); reject(new Error('Installer checksum did not match; download removed')); return; }
          resolve(dest);
        });
      });
      out.on('error', e => { fs.rmSync(dest, { force: true }); reject(e); });
      res.on('error', e => { fs.rmSync(dest, { force: true }); reject(e); });
    }}); }
    catch (e) { if (downloadStarted) fs.rmSync(dest, { force: true }); throw e; }

    let runner, args;
    if (process.platform === 'win32') {
      const ps1 = path.join(updateDir, `install-${stamp}.ps1`);
      fs.writeFileSync(ps1, WIN_INSTALL_SCRIPT.replace('@@PID@@', String(process.pid)).replace('@@INSTALLER@@', psQuote(dest)).split('@@APP@@').join(psQuote(process.execPath)));
      runner = 'powershell.exe'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1];
    } else {
      // process.execPath is <Name>.app/Contents/MacOS/<Name>; the app bundle is what gets replaced.
      const m = process.execPath.match(/^(.*?\.app)\//);
      const target = m ? m[1] : '/Applications/The Smart POS.app';
      const sh = path.join(updateDir, `install-${stamp}.sh`);
      fs.writeFileSync(sh, MAC_INSTALL_SCRIPT.replace('@@ARCHIVE@@', () => shQuote(dest)).replace('@@TARGET@@', () => shQuote(target)).replace('@@WORK@@', () => shQuote(path.join(updateDir, `work-${stamp}`))), { mode: 0o700 });
      fs.chmodSync(sh, 0o700);
      runner = '/bin/sh'; args = [sh];
    }
    const child = spawn(runner, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    app.quit();
    return { ok: true, path: dest, restarting: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
const backupDir = () => cfg.dir || path.join(app.getPath('documents'), 'TheSmartPOS-Backups');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = d => `${ymd(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function readLog() { try { return JSON.parse(fs.readFileSync(logFile(), 'utf8')); } catch { return []; } }
function writeLog(entry) {
  const l = readLog(); l.unshift(entry);
  fs.writeFileSync(logFile(), JSON.stringify(l.slice(0, 200), null, 1));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'POS', backgroundColor: '#f4f5f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(rendererFile('index.html'));
  // A live UI bundle must never leave the shop without a working POS: if it fails to
  // load or crashes, drop it and fall back to the UI bundled with the installer.
  const fallbackToBundled = () => {
    if (uiUpdater.resolveRendererDir().source !== 'live') return;
    uiUpdater.discardActive();
    if (win && !win.isDestroyed()) win.loadFile(rendererFile('index.html'));
  };
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => { if (isMainFrame && code !== -3) fallbackToBundled(); });
  win.webContents.on('render-process-gone', fallbackToBundled);
}

function openCustomerDisplay() {
  if (customerWin && !customerWin.isDestroyed()) { customerWin.show(); customerWin.focus(); return; }
  const displays = screen.getAllDisplays();
  const secondary = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
  const bounds = secondary ? { x: secondary.bounds.x, y: secondary.bounds.y, width: secondary.bounds.width, height: secondary.bounds.height } : { width: 900, height: 650 };
  customerWin = new BrowserWindow({ ...bounds, title: 'Customer Display', backgroundColor: '#0b1220', webPreferences: { preload: path.join(__dirname, 'customer-preload.js'), contextIsolation: true, nodeIntegration: false } });
  customerWin.setMenuBarVisibility(false);
  customerWin.loadFile(rendererFile('customer-display.html'));
  customerWin.webContents.on('did-finish-load', () => { if (customerDisplayData) customerWin?.webContents.send('customer-display:data', customerDisplayData); });
  customerWin.on('closed', () => { customerWin = null; });
}
ipcMain.handle('customer-display:open', () => { openCustomerDisplay(); return true; });
ipcMain.handle('customer-display:close', () => { if (customerWin && !customerWin.isDestroyed()) customerWin.close(); return true; });
ipcMain.handle('customer-display:update', (_e, data) => {
  customerDisplayData = { ...(customerDisplayData || {}), ...data };
  if (customerWin && !customerWin.isDestroyed()) customerWin.webContents.send('customer-display:data', customerDisplayData);
  return true;
});
ipcMain.on('customer-display:phone-input', (_e, phone) => {
  if (win && !win.isDestroyed()) win.webContents.send('customer-display:phone-input', String(phone || '').replace(/\D/g, '').slice(0, 20));
});
ipcMain.on('customer-display:phone-submit', () => {
  if (win && !win.isDestroyed()) win.webContents.send('customer-display:phone-submit');
});
ipcMain.handle('branding:pick-logo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose business logo', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (canceled || !filePaths[0]) return '';
  const file = filePaths[0], ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
});

// ---- data load/save (atomic write, keeps previous copy) ----
ipcMain.handle('db:load', () => {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    try { return JSON.parse(fs.readFileSync(dataFile() + '.prev', 'utf8')); }
    catch (previousError) {
      // Do not let the renderer interpret a damaged existing database as a
      // first launch: that would create a new file over the user's data.
      throw new Error(`The local database could not be read. Original file: ${e.message}. Previous copy: ${previousError.message}. No data was changed.`);
    }
  }
});
ipcMain.handle('db:save', (_e, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.settings || !Array.isArray(data.products)) throw new Error('Refusing to save invalid database data');
  const f = dataFile(), tmp = f + '.tmp';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const serialized = JSON.stringify(data);
  const check = JSON.parse(serialized);
  if (!check || !check.settings || !Array.isArray(check.products)) throw new Error('Database validation failed; existing data was preserved');
  fs.writeFileSync(tmp, serialized);
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.prev');
  try { fs.renameSync(tmp, f); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return true;
});
ipcMain.handle('db:path', () => dataFile());

// Use the operating system print dialog so the user can select any installed
// printer. If no printer is installed, generate a PDF and ask where to save it.
ipcMain.handle('print:html', async (_event, job) => {
  if (!job || typeof job.body !== 'string' || typeof job.css !== 'string') throw new Error('Invalid print job');
  const mm = job.pageSizeMm;
  const customPageMm = mm && Number.isFinite(Number(mm.width)) && Number.isFinite(Number(mm.height)) && Number(mm.width) > 1 && Number(mm.height) > 1 && Number(mm.width) <= 2000 && Number(mm.height) <= 2000
    ? { width: Number(mm.width), height: Number(mm.height) }
    : null;
  const standardPaper = ['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid'].includes(job.paperSize) ? job.paperSize : null;
  const printPageSize = customPageMm ? { width: Math.round(customPageMm.width * 1000), height: Math.round(customPageMm.height * 1000) } : standardPaper;
  const printers = await win.webContents.getPrintersAsync().catch(() => []);
  const printWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const title = String(job.title || 'Print').replace(/[<>]/g, '');
  let body = job.body;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html,body{font-family:Arial,sans-serif;margin:0;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}${job.css}</style></head><body>${body}</body></html>`;
  try {
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    if (printers.length) {
      return await new Promise((resolve, reject) => {
        const options = { silent: false, printBackground: true };
        if (printPageSize) options.pageSize = printPageSize;
        printWindow.webContents.print(options, (success, reason) => {
          if (success) resolve({ ok: true, mode: 'print' });
          else if (/cancel/i.test(reason || '')) resolve({ ok: false, cancelled: true });
          else reject(new Error(reason || 'The print dialog could not start'));
        });
      });
    }
    const pdfOptions = { printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } };
    if (customPageMm) pdfOptions.pageSize = { width: customPageMm.width / 25.4, height: customPageMm.height / 25.4 };
    else if (standardPaper) pdfOptions.pageSize = standardPaper;
    const pdf = await printWindow.webContents.printToPDF(pdfOptions);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save print job as PDF', defaultPath: `${title || 'Print'}.pdf`, filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(filePath, pdf);
    return { ok: true, mode: 'pdf', filePath };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
  }
});

// ---- backup ----
function runBackup(kind) {
  if (running) return { ok: false, error: 'A backup is already running' };
  running = true;
  const started = new Date();
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    if (!fs.existsSync(dataFile())) throw new Error('No data to back up yet');
    JSON.parse(fs.readFileSync(dataFile(), 'utf8'));            // source must be valid
    const name = `TheSmartPOS_Backup_${stamp(started)}.json`;
    const dest = path.join(dir, name);
    fs.copyFileSync(dataFile(), dest, fs.constants.COPYFILE_EXCL); // never overwrite
    const check = JSON.parse(fs.readFileSync(dest, 'utf8'));       // verify what was written
    if (!Array.isArray(check.products) || !check.settings) throw new Error('Backup verification failed');
    // retention: delete old, but always keep newest 3
    const files = fs.readdirSync(dir).filter(f => /^TheSmartPOS_Backup_.*\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    const limit = Date.now() - cfg.keep * 86400000;
    files.slice(3).filter(x => x.t < limit).forEach(x => { try { fs.unlinkSync(path.join(dir, x.f)); } catch {} });
    const entry = { ok: true, kind, at: started.toISOString(), file: dest, size: fs.statSync(dest).size };
    writeLog(entry);
    return entry;
  } catch (e) {
    const entry = { ok: false, kind, at: started.toISOString(), error: e.message };
    try { writeLog(entry); } catch {}
    if (win && !win.isDestroyed()) win.webContents.send('backup:error', e.message);
    return entry;
  } finally { running = false; }
}

function tick() {
  if (!cfg.on || running) return;
  const now = new Date(), [h, m] = /^(\d{2}):(\d{2})$/.test(cfg.time) ? cfg.time.split(':').map(Number) : [2, 0];
  const offset = cfg.frequency === 'weekly' ? (now.getDay() - Number(cfg.weekday) + 7) % 7 : 0;
  const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const due = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate(), h, m);
  if (now < due) return;
  // Only a successful automatic run satisfies the schedule. Manual backups must
  // not suppress the scheduled restore point for the day/week.
  const last = readLog().find(x => x.ok && x.kind === 'auto');
  if (last) {
    const lastAt = new Date(last.at);
    if (lastAt >= due) return;
  }
  runBackup('auto'); // startup catch-up when the scheduled time was missed
}

ipcMain.handle('backup:config', (_e, c) => {
  if (!c || typeof c !== 'object') throw new Error('Invalid backup settings');
  const next = { ...cfg, ...c };
  if (typeof next.dir !== 'string' || !/^\d{2}:\d{2}$/.test(next.time) || !['daily', 'weekly'].includes(next.frequency) || !Number.isInteger(Number(next.weekday)) || Number(next.weekday) < 0 || Number(next.weekday) > 6 || !Number.isFinite(Number(next.keep)) || Number(next.keep) < 1) throw new Error('Invalid backup settings');
  const dir = next.dir || path.join(app.getPath('documents'), 'TheSmartPOS-Backups');
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
  catch (e) { throw new Error(`Backup folder is not writable: ${e.message}`); }
  cfg = next;
  setTimeout(tick, 500); return backupDir();
});
ipcMain.handle('backup:run', () => runBackup('manual'));
ipcMain.handle('backup:list', () => ({ dir: backupDir(), log: readLog().slice(0, 30) }));
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('backup:restore', async () => {
  const r = await dialog.showOpenDialog(win, {
    defaultPath: fs.existsSync(backupDir()) ? backupDir() : undefined,
    filters: [{ name: 'Backup', extensions: ['json'] }], properties: ['openFile']
  });
  if (r.canceled) return { cancelled: true };
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(data.products) || !data.settings) throw new Error('Not a valid The Smart POS backup');
    if (fs.existsSync(dataFile())) {   // safety copy of current data first
      fs.mkdirSync(backupDir(), { recursive: true });
      fs.copyFileSync(dataFile(), path.join(backupDir(), `PreRestore_${stamp(new Date())}.json`));
    }
    const target = dataFile(), tmp = target + '.restore.tmp';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data));
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.renameSync(tmp, target);
    return { data };
  } catch (e) { return { error: e.message }; }
});

app.whenReady().then(() => {
  createWindow();
  setInterval(tick, 60000);
  setTimeout(tick, 4000);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());