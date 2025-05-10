var shuffle = function(nums, n) {
    let result = [];
    let ynums = nums.splice(n);
    for (let i=0; i<n; i++){
        result.push(nums[i])
        result.push(ynums[i]);
    }
    return result;
};
console.log(shuffle([2,5,1,3,4,7],3))